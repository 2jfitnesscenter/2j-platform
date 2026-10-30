import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, rolePermissions, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { z } from 'zod';

type SqlClient = ReturnType<typeof createDatabase>['client'];

export type IntegrationFlags = Readonly<Record<'trainingSso' | 'trainingServiceCalls' | 'trainingLinking' | 'trainingSignals' | 'trainingProvisioning' | 'push' | 'passkeys' | 'memberAuthPilot' | 'memberBookingPilot', boolean>>;

const profileLabels: Record<string, string> = { admin: 'Administración', trainer: 'Entrenador/a', 'reception-management': 'Recepción y gestión', accountant: 'Contabilidad' };
const groupLabels: Record<string, string> = {
  clients: 'Clientes', calendar: 'Agenda', reservations: 'Reservas', entitlements: 'Cuotas y derechos', billing: 'Economía', store: 'Tienda', catalog: 'Catálogo y precios',
  staff: 'Equipo', communication: 'Comunicación', documents: 'Documentos', forms: 'Formularios', consents: 'Consentimientos', followup: 'Seguimiento', training: 'Entrenamiento',
  health: 'Salud', news: 'Novedades', settings: 'Ajustes', timeclock: 'Fichaje', owner: 'Propietario',
};

/**
 * Configuración (paridad visual 11): resumen de SOLO LECTURA de lo que Platform ya gobierna — reglas de pago de `economic_settings`, perfiles de permisos
 * y el estado (activado/desactivado) de las integraciones. No devuelve secretos, claves, URLs ni valores de configuración: solo booleanos y nombres de
 * permisos. Requiere `settings.manage`. Los perfiles no se editan aquí: los cambios de permisos pasan por aprobación del propietario (D124, A48).
 */
export function registerSettingsOverviewRoutes(app: FastifyInstance<any, any, any, any, any>, db: SqlClient, resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>, integrations: IntegrationFlags) {
  app.get('/api/settings/appearance', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await resolveAuthorization(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'settings.manage')) return reply.code(403).send({ error: 'permission_denied' });
    const [row] = await db`SELECT theme,updated_at AS "updatedAt" FROM staff_appearance_preferences WHERE actor_id=${context.actorId}`;
    return { theme: row?.theme ?? 'light', updatedAt: row?.updatedAt ?? null };
  });
  app.put('/api/settings/appearance', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await resolveAuthorization(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'settings.manage')) return reply.code(403).send({ error: 'permission_denied' });
    const parsed = z.object({ theme: z.enum(['light','dark','system']) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const [row] = await db`INSERT INTO staff_appearance_preferences(actor_id,theme) VALUES (${context.actorId},${parsed.data.theme}) ON CONFLICT(actor_id) DO UPDATE SET theme=EXCLUDED.theme,updated_at=now() RETURNING theme,updated_at AS "updatedAt"`;
    return row;
  });
  app.get('/api/settings/overview', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await resolveAuthorization(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'settings.manage')) return reply.code(403).send({ error: 'permission_denied' });
    const [settings] = await db`SELECT due_day AS "dueDay",grace_days AS "graceDays",timezone,debt_blocks_new_reservations AS "debtBlocksNewReservations",fiscal_legal_gate_open AS "fiscalLegalGateOpen",document_retention_months AS "documentRetentionMonths" FROM economic_settings WHERE singleton=true`;
    const profiles = Object.entries(rolePermissions).filter(([id]) => id !== 'owner').map(([id, grants]) => {
      const wildcard = grants.includes('*');
      const groups = new Map<string, string[]>();
      if (!wildcard) for (const permission of grants) { const group = permission.split('.')[0] ?? permission; groups.set(group, [...(groups.get(group) ?? []), permission]); }
      return {
        id, label: profileLabels[id] ?? id, wildcard, permissionCount: wildcard ? null : grants.length,
        groups: [...groups.entries()].map(([group, permissions]) => ({ id: group, label: groupLabels[group] ?? group, permissions: [...permissions].sort() })).sort((left, right) => left.label.localeCompare(right.label, 'es')),
      };
    });
    return {
      timezone: 'Atlantic/Canary',
      payments: settings ? { dueDay: Number(settings.dueDay), graceDays: Number(settings.graceDays), timezone: String(settings.timezone), debtBlocksNewReservations: settings.debtBlocksNewReservations === true, fiscalLegalGateOpen: settings.fiscalLegalGateOpen === true, documentRetentionMonths: settings.documentRetentionMonths == null ? null : Number(settings.documentRetentionMonths), methods: ['cash', 'card', 'transfer', 'direct_debit', 'other'] } : null,
      profiles,
      integrations,
    };
  });
}
