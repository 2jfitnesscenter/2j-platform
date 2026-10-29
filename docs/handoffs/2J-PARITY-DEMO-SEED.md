# Handoff — perfil sintético de administración profesional

- Base: `abd31b89ffc2ce64c9fae167f2226267234b2348`.
- El seed `apps/api/scripts/seed-demo.ts` crea/repara `Sofía Demo` (`d070…0105`) enlazado solo al actor local `local-demo:admin`; su contexto local conserva rol `admin` y el enlace server-side resuelve su ficha profesional.
- `Alex Rivera` continúa enlazado a `local-demo:trainer`. `Nora Vega` y otros profesionales sintéticos ya existían; la prueba verifica Nora como segundo entrenador activo.
- Cambios idempotentes y limitados a UUID sintéticos fijos. Si cualquiera de los actores ya está ligado a otra fila, el seed falla sin apropiarse de ella.
- El seed local sigue restringido a `NODE_ENV=development|test`, host loopback y base `2j_demo`. El modo staging exige además `STAGING_SEED=1` y `STAGING_SEED_HOST=2jfit.com`; mantiene el mismo host loopback y base aislada `2j_demo`. No se ejecutó en staging ni se usaron datos reales.
- El seed enlaza el actor Basic Auth sintético `local-demo:admin` a la ficha profesional sintética de Sofía. No asigna permisos ni cambia roles. Para que ese actor vea el panel del propietario en el API de staging, el servicio `platform-admin-api` debe arrancar con `PLATFORM_OWNER_ACTOR_ID=local-demo:admin`; el servidor concede únicamente `owner.panel.read` a ese actor configurado. Esta variable corresponde solo al servicio Admin de staging y no debe configurarse en producción. El cambio de configuración del servicio está separado del seed.
- No añade migraciones, cambia permisos de producción ni altera autenticación real.
- Validación: prueba focal ejecutada en PostgreSQL 16 sintético desechable nuevo: 1/1 PASS. Incluye creación/enlace de Admin, ficha profesional, segundo entrenador activo, reparación idempotente, resolución de `/api/timeclock/self` y rechazo del actor no vinculado.
- Validación local actualizada en PostgreSQL sintético desechable: `demo-seed.test.mjs` 2/2 PASS (guardas de destino y reparación del seed). API typecheck PASS, build monorepo 9/9 PASS y `git diff --check` PASS.
- Comando preparado para el operador vía `2j-staging`: `sudo 2j-staging seed --target-host 2jfit.com`. Requiere `DOMAIN=2jfit.com` y una imagen construida desde la rama del PR #142; no se ha ejecutado en servidor. Antes de probar el panel de propietario, verificar también `PLATFORM_OWNER_ACTOR_ID=local-demo:admin` en el contenedor `platform-admin-api` de staging.
- Revisión independiente y CI: pendientes.
- Conflicto detectado: el runbook actual configura `DOMAIN=2jfit.es`, mientras la instrucción del propietario permite seed solo para `2jfit.com`. El wrapper rechazará cualquier otro host; no se cambia la configuración de dominio existente ni se toca el servidor.
