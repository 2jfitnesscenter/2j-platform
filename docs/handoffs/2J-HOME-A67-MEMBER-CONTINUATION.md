# A67 — continuación de Home para socios

## Estado actualizado

- #116, #126, #157 y #168 están integrados en `main`; #168 consume la puerta A68 de Platform para Mi evolución.
- Base de este lote: `main` con HEAD `231c004b12a692ff76eb31c729c005c1c88488f4`.
- «Mis facturas» ya no está desconectado: Platform `main` ofrece el listado autenticado de socio y su descarga PDF autoacotada a la sesión.
- El nuevo cambio se documenta en `2J-HOME-A67-FINAL-BATCH.md`. Su estado de CI y revisión independiente depende del HEAD de la PR final.

## Estado funcional de Home

- Mi evolución lee `GET /api/me/training-summary`. Solo representa el resumen agregado cuando Platform lo devuelve disponible; la puerta A68 de entitlement y consentimiento permanece del lado servidor. Mediciones, gráficos históricos, evaluaciones y salud siguen **No conectado**.
- Perfil personal permanece de solo lectura conforme a D238/D239.
- Reservas y lista de espera usan las rutas de socio; el estado de reserva, elegibilidad y políticas proviene de Platform.
- Tienda lee catálogo e historial de compras desde rutas de socio; el historial no equivale a checkout.
- Modo demo usa fixtures ficticias y no hace llamadas de sesión ni ofrece operaciones reales.

## Validación histórica

La integración #168 se validó con 49 pruebas de client-app, typecheck, build, build-demo y el workflow E2E Home → Platform → Búnker sobre sus SHAs publicados. Para el lote final, consultar el handoff `2J-HOME-A67-FINAL-BATCH.md` y la ejecución CI asociada a la nueva PR.
