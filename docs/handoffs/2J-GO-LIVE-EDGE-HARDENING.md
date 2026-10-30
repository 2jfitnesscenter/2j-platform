# Handoff — preparación del perímetro de producción

## Estado verificado

- Base consultada: `origin/main` en `6d46f06523285882e518de0512af11e11be46461`.
- El comando sintético `sudo 2j-staging seed --target-host 2jfit.com` ya existe en el script de staging y el seed valida simultáneamente `NODE_ENV=development`, `STAGING_SEED=1` y host exacto `2jfit.com`; no se duplicó.
- El seed existente crea el perfil de personal sintético Admin/Trainer y datos operativos sintéticos. No crea factura emitida. No se inventaron datos fiscales: A65 requiere que esos campos estén vacíos hasta configurarlos, y el flujo fiscal bloquea emisión cuando faltan.
- La configuración Caddy versionada solo es el generador de staging. No se encontró Caddyfile de producción en el repositorio.
- No existe `ADMIN_PROMOTION_STEP_UP` en el código/documentación de configuración revisados; se dejó como control requerido, no implementado.
- El workflow E2E consume `BUNKER_REPO_READ_TOKEN`; su caducidad aproximada a mediados de enero de 2027 procede de la instrucción recibida, no de metadatos verificables en Git.
- Auditd no está configurado por este cambio. La plantilla incluida requiere revisión y aplicación operativa separada.

## Cambios de esta rama

- `docs/release/PRODUCTION-EDGE-HARDENING.md`: política propuesta para rutas públicas/privadas, identidad de propietario, allowlist opcional por entorno, auditd y token de lectura Búnker.
- `docs/release/PRODUCTION-READINESS-CHECKLIST.md`: enlace a los controles pendientes y aviso de que no se aplican desde este PR.

## Límites

Documentación únicamente. No se ejecutó el seed, no se abrió staging, no se instalaron reglas auditd, no se modificó Caddy, no se tocaron DNS/secrets/servidores y no se aplicaron migraciones ni cambios a bases de datos.
