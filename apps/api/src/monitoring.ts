import { readdirSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];
const startedAt = Date.now();
const migrationsDirectory = new URL('../migrations/', import.meta.url);

type Check = { id: string; label: string; ok: boolean; detail: string };

/**
 * Administración · Monitorización (paridad con BackendFunctions.jsx de 2jfit-admin). Solo lectura, solo `owner.panel.read`.
 * Devuelve únicamente comprobaciones con resultado sí/no, contadores y marcas de tiempo: nunca variables de entorno, cadenas de
 * conexión, claves, versiones de dependencias ni rutas del servidor.
 */
export function registerMonitoringRoutes(app: FastifyInstance<any, any, any, any, any>, db: SqlClient, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  app.get('/api/admin/monitoring', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await resolve(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'owner.panel.read')) return reply.code(403).send({ error: 'permission_denied' });

    const checks: Check[] = [];
    const counts: Record<string, number | null> = { activeClients: null, activePlanAssignments: null, openCashRegisters: null, scheduledSessionsNext7Days: null };
    let latencyMs: number | null = null;
    let databaseOk = false;
    try {
      const began = Date.now();
      await db`SELECT 1`;
      latencyMs = Date.now() - began;
      databaseOk = true;
      checks.push({ id: 'database', label: 'Base de datos', ok: true, detail: `Responde en ${latencyMs} ms` });
    } catch { checks.push({ id: 'database', label: 'Base de datos', ok: false, detail: 'No responde' }); }

    if (databaseOk) {
      try {
        const [row] = await db`SELECT count(*)::int AS applied FROM schema_migrations`;
        const expected = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).length;
        const applied = Number(row?.applied ?? 0);
        checks.push({ id: 'migrations', label: 'Migraciones aplicadas', ok: applied >= expected, detail: applied >= expected ? `${applied} de ${expected}` : `Faltan ${expected - applied} (${applied} de ${expected})` });
      } catch { checks.push({ id: 'migrations', label: 'Migraciones aplicadas', ok: false, detail: 'No se pudo comprobar' }); }
      try {
        const [row] = await db`SELECT
          (SELECT count(*)::int FROM clients WHERE status='active') AS "activeClients",
          (SELECT count(*)::int FROM client_plan_assignments a WHERE a.status<>'cancelled' AND a.starts_on<=(now() AT TIME ZONE 'Atlantic/Canary')::date AND (a.ends_on IS NULL OR a.ends_on>=(now() AT TIME ZONE 'Atlantic/Canary')::date)) AS "activePlanAssignments",
          (SELECT count(*)::int FROM economic_cash_sessions WHERE status='open') AS "openCashRegisters",
          (SELECT count(*)::int FROM calendar_sessions WHERE status='scheduled' AND starts_at>=now() AND starts_at<now()+interval '7 days') AS "scheduledSessionsNext7Days"`;
        for (const key of Object.keys(counts)) counts[key] = Number(row?.[key] ?? 0);
        checks.push({ id: 'data', label: 'Lectura de datos del centro', ok: true, detail: 'Clientes, cuotas, caja y agenda legibles' });
      } catch { checks.push({ id: 'data', label: 'Lectura de datos del centro', ok: false, detail: 'No se pudieron leer los contadores' }); }
    }
    checks.push({ id: 'api', label: 'Servidor de la API', ok: true, detail: 'Atiende peticiones' });

    return {
      timezone: 'Atlantic/Canary',
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      healthy: checks.every((check) => check.ok),
      checks,
      counts,
    };
  });
}
