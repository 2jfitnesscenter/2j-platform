# Paridad Base44: Espacios y Servicios

## Alcance

Se separó la navegación de **Espacios** y **Servicios** en Mi gimnasio, siguiendo la división de la referencia Base44. `#spaces` abre las áreas y sus servicios asociados; `#services` abre el catálogo de actividades y conserva el acceso comercial a Cuotas y planes para quienes ya tienen `catalogPricingManage`.

## Implementación

- Ambos destinos reutilizan las APIs Platform existentes (`GET /api/areas`, `GET /api/services` y las operaciones ya disponibles); no se incorporó lógica de Base44, endpoints, migraciones ni reglas comerciales nuevas.
- Se mantiene `#services` como enlace existente al catálogo de Servicios.
- Las capacidades de navegación y escritura no cambian: la visibilidad de ambas pantallas depende de `calendar`, y las acciones de administración siguen dependiendo de `catalogPricingManage`.
- La pantalla Espacios muestra áreas, servicios relacionados, estados y los estados existentes de carga/error/vacío.

## Verificación

- `pnpm --filter @2j/admin-web test`: 186/186 PASS.
- `pnpm --filter @2j/admin-web typecheck`: PASS.
- `pnpm --filter @2j/admin-web build`: PASS.
- `git diff --check`: PASS.
- No se generaron capturas de navegador: esta pasada se validó con tests de interfaz en jsdom y build; no se presenta evidencia visual como si fuera una captura real.

## Límites

No se modificaron APIs, permisos, backend, migraciones, Base44, Caja, Asistencia, Resumen, Home ni Búnker. La revisión visual independiente corresponde al siguiente gate de paridad.
