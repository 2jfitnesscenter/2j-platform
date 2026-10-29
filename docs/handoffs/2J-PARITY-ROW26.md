# Handoff — paridad API, fila 26 Rendimiento Búnker

- Base verificada: `abd31b89ffc2ce64c9fae167f2226267234b2348`.
- Entrega: propuesta documental y esquema JSON para una lectura limitada de rendimiento deportivo desde Búnker a Platform.
- No implementa endpoint, migración, cliente HTTP, persistencia ni Home/Búnker. Ningún dato real se lee o modifica.
- Respeta identidad `personId` y link canónico; no matching por email/teléfono ni copia de IDs de faceta.
- Excluye `S.measurements`, métricas corporales/salud, Health/device data, estados genéricos, rutinas y entrenos completos.
- Revisión independiente de Work Búnker, lista exacta de métricas y dirección de autenticación Platform→Búnker pendientes antes de implementar. Si algún agregado es salud, queda bloqueado por D02/D23/D33.
- Contrato propuesto: `GET /api/internal/platform/v1/persons/{personId}/performance-summary`, HMAC/replay, `no-store`; estado no implementado.
- Migraciones: ninguna.
- Pruebas automatizadas: no aplican a docs/schema JSON; `git diff --check` y parseo JSON se ejecutarán antes del push.
- Merge, despliegue y cambios de datos: no realizados.
