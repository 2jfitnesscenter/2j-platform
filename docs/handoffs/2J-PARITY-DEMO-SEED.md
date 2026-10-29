# Handoff — perfil sintético de administración profesional

- Base: `abd31b89ffc2ce64c9fae167f2226267234b2348`.
- El seed `apps/api/scripts/seed-demo.ts` crea/repara `Sofía Demo` (`d070…0105`) enlazado solo al actor local `local-demo:admin`; su contexto local conserva rol `admin` y el enlace server-side resuelve su ficha profesional.
- `Alex Rivera` continúa enlazado a `local-demo:trainer`. `Nora Vega` y otros profesionales sintéticos ya existían; la prueba verifica Nora como segundo entrenador activo.
- Cambios idempotentes y limitados a UUID sintéticos fijos. Si cualquiera de los actores ya está ligado a otra fila, el seed falla sin apropiarse de ella.
- La utilidad CLI se mantiene restringida a `NODE_ENV=development|test`, host loopback y base `2j_demo`. No se ejecutó en staging ni se usaron datos reales.
- No añade migraciones, cambia permisos de producción ni altera autenticación real.
- Validación: prueba focal ejecutada en PostgreSQL 16 sintético desechable nuevo: 1/1 PASS. Incluye creación/enlace de Admin, ficha profesional, segundo entrenador activo, reparación idempotente, resolución de `/api/timeclock/self` y rechazo del actor no vinculado.
- No se ejecutó la utilidad CLI contra staging. La guardia actual del comando permite solo `NODE_ENV=development|test`, host loopback y base `2j_demo`; por tanto este cambio prepara datos sintéticos para el piloto local, pero no cumple aún la ejecución/semilla específica de staging.
- Revisión independiente y CI: pendientes.
