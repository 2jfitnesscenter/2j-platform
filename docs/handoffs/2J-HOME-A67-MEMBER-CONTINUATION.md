# A67 — Integración local de Home para revisión

## Estado

- Rama local aislada: `agent/codex/2J-HOME-A67-MEMBER-CONTINUATION`.
- Base actualizada: `main` en `fe899e900e66598779136fea351d488e8937db39`; incluye #157 y la puerta A68 de Mi evolución (#169).
- PR #168 está restackeado sobre `main`. No se ha fusionado ni desplegado.

## Alcance integrado

- #116, #126 y #157 ya están en la base `main`; no se duplican en el delta actual de PR #168.
- Mi evolución usa el resumen de solo lectura 2J-089 (`GET /api/me/training-summary`) para mostrar programa y actividad agregada cuando Platform confirma una vinculación activa. No expone IDs de Búnker.
- A68/#169 ya está en `main`: Platform exige entitlement efectivo y consentimiento publicado/aceptado/no revocado. Home presenta estados bloqueados como «Sin datos disponibles»; no replica la regla.
- En demo, Mi evolución muestra `No conectado · DEMO · Datos ficticios`, no hace llamadas y no presenta métricas simuladas. Mediciones, gráficos, evaluaciones y salud quedan `No conectado` porque 2J-089 no incluye esos datos.
- Perfil muestra los datos existentes en modo consulta y explica cómo solicitar cambios.
- Compras ya estaba conectada a `GET /api/me/store/purchases`; la prueba actual verifica datos del endpoint y el estado de demo sintética.
- A64/A66: facturas permitidas en Home. Perfil incluye «Mis facturas» como `No conectado` mientras Platform no publique un endpoint autenticado y acotado al socio para listar y descargar sus PDF. No se simula una descarga.

## Decisiones y límites aplicados

- D238/D239: no se habilita edición de nombre, apellidos, teléfono, dirección, DNI/NIE, nacimiento ni correo, ni formulario de solicitud en Home. Se indica la vía presencial o WhatsApp con verificación del equipo.
- Contrato de facturas de socio pendiente: Platform expone rutas económicas internas con permiso `billing.read-tax` (`GET /api/economics/charges/:chargeId/documents` y `GET /api/economics/documents/:documentId/pdf`), no un listado/descarga autenticado y auto-acotado para miembros. Home no las llama ni recibe IDs de documentos desde el cliente.
- D238/D239: los datos personales siguen siendo de solo lectura; no se añade edición de perfil.
- No se cambian Platform, Búnker, contratos de backend, permisos, cuotas ni reglas de reserva.

## Validación

Tras restack sobre `main` y corregir el estado A68 bloqueado en Mi evolución: `pnpm --filter @2j/client-app test` 49/49; `typecheck` correcto; `build` correcto; `build:demo` correcto; `git diff --check` correcto. Se añadió regresión para `summaryStatus: blocked` con `consent_required`; Home muestra «Sin datos disponibles». Son pruebas de cliente con respuestas sintéticas; no se probó una sesión real.

## Revisión requerida

Revisión independiente del restack (`5e4a80a895b5330d8623cf4a04cf5e0352c48c74`) encontró un P2: el bloqueo A68 se representaba como «No conectado». Corregido para mostrar «Sin datos disponibles» y cubierto por regresión; se requiere confirmación independiente de este arreglo en el HEAD actualizado. CI remoto se está ejecutando de nuevo sobre el nuevo HEAD; no hay despliegue.
