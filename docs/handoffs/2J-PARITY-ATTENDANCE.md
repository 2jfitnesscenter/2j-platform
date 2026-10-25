# 2J Parity: asistencia ✓ / ✗

## Alcance

Primera entrega acotada de paridad visual para marcar asistencia en Agenda de Admin Web y Staff App. La referencia consultada es el `origin/main` de `2jfitnesscenter/2j-fitness-admin` en `ccfffdb04a90307bf03f1c66dd8088782482b226`, en particular `AttendancePicker.jsx` y `SessionAttendanceSheet.jsx`.

## Cambio

- Las acciones existentes de asistencia muestran iconos ✓ y ✗ en ambas interfaces.
- El estado actual se comunica con `aria-pressed` y un estilo seleccionado; los controles mantienen nombre accesible, foco visible y un área táctil mínima de 44 px.
- Se conservan los endpoints y transiciones existentes (`attended`, `no_show`, `reserved`). No se modifican API, reglas, permisos ni datos.

## Verificación local

- Admin Web: 186/186 tests PASS.
- Staff App: 7/7 tests PASS.
- Typecheck Admin Web y Staff App: PASS.
- Build Admin Web y Staff App: PASS.
- `git diff --check`: PASS.

## Evidencia visual

No se adjuntan capturas: no se inició un runtime integrado con API y datos de prueba para capturar una pantalla real. Las pruebas verifican el marcado visible, nombres accesibles, estado y controles SVG, pero no sustituyen la aceptación visual en navegador.

## Fuera de alcance

No se tocaron Home, Búnker, Base44, caja, backend, migraciones ni otros módulos de producto. La UI de caja sigue pendiente de las correcciones y del diseño aprobados por separado.
