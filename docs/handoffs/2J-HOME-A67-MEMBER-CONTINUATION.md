# A67 — Integración local de Home para revisión

## Estado

- Rama local aislada: `agent/codex/2J-HOME-A67-MEMBER-CONTINUATION`.
- Base local observada: `origin/main` en `dfcb1256b233c94ec41e0d177ecd699636258fa4`.
- No se ha publicado, fusionado ni desplegado. `AGENTS.md` prohíbe llamadas a proveedores y auto-fusión; los refs `origin/*` son la copia local disponible, no una consulta en vivo.

## Alcance integrado

- #116: la tarjeta de clase presenta lista de espera solo cuando Platform devuelve elegibilidad explícita.
- #126: Perfil representa los estados y cantidades `assignment.payment` recibidos de `GET /api/me/membership`; Home no calcula saldos, vencimientos ni bloqueos.
- #157: Buzón del socio usa los endpoints autenticados de conversación y conserva la idempotencia al reintentar un borrador editado.
- Mi evolución usa el resumen de solo lectura 2J-089 (`GET /api/me/training-summary`) para mostrar programa y actividad agregada cuando Platform confirma una vinculación activa. No expone IDs de Búnker.
- En demo, Mi evolución muestra `No conectado · DEMO · Datos ficticios`, no hace llamadas y no presenta métricas simuladas. Mediciones, gráficos, evaluaciones y salud quedan `No conectado` porque 2J-089 no incluye esos datos.
- Perfil muestra los datos existentes en modo consulta y explica cómo solicitar cambios.
- Compras ya estaba conectada a `GET /api/me/store/purchases`; la prueba actual verifica datos del endpoint y el estado de demo sintética.

## Decisiones y límites aplicados

- D238/D239: no se habilita edición de nombre, apellidos, teléfono, dirección, DNI/NIE, nacimiento ni correo, ni formulario de solicitud en Home. Se indica la vía presencial o WhatsApp con verificación del equipo.
- D106/A63: no se añade descarga de facturas. No existe endpoint de documentos fiscales para el socio y el gate fiscal permanece cerrado; no se llama al endpoint interno económico ni se crea una API paralela.
- No se cambian Platform, Búnker, contratos de backend, permisos, cuotas ni reglas de reserva.

## Validación

En el HEAD previo al commit: `pnpm --filter @2j/client-app test` 48/48; `typecheck` correcto; `build` correcto; `build:demo` correcto; `git diff --check` correcto. Las dependencias se instalaron con `pnpm install --offline --frozen-lockfile`, reutilizando la caché local. Son pruebas de cliente con respuestas sintéticas; no se probó una sesión real.

## Revisión requerida

Revisión independiente completada por otro agente sobre `5f47137989179798cb96ab406d801ee072af23a6`: sin hallazgos. Verificó presentación de pagos sin recálculo, rutas autenticadas de mensajes y compras, alcance de 2J-089, elegibilidad explícita y respeto de D106/D238/D239. No verificó CI remoto, secret scan, staging ni una sesión real. `gitleaks` y `trufflehog` no están instalados localmente.
