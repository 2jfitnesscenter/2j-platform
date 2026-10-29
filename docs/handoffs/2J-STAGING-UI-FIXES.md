# Handoff — ajustes de interfaz de staging

## Alcance

- `Staff > profesional > Horario`: conservar la referencia al formulario antes de esperar la respuesta y reiniciarlo tras guardar.
- `Configuración > Centro`: quitar los campos de horario duplicados y enlazar con la pestaña conectada `Horario y turnos`.
- App Shell: mostrar `Staging` para los dominios `2jfit.es` y `2jfit.com`, sin alterar la autenticación ni la configuración del entorno.

## Verificación

- La regresión del horario fallaba antes del arreglo porque el formulario conservaba el valor escrito después de guardar.
- Admin Web: 358/358 tests PASS.
- Typecheck del monorepo PASS (11 tareas).
- Build forzado del monorepo PASS (9 tareas).
- `git diff --check` PASS.
- Pendiente para el SHA publicado: checks `quality`, `secret scan` y E2E de GitHub Actions.

No se modificaron APIs, datos, permisos, migraciones ni infraestructura.
