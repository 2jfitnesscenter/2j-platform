# Handoff — PR #89: refresco del upstream API

## Estado

Cambio aislado que continúa PR #89 en una rama Draft separada; no se ha ejecutado en ningún servidor.

## Causa y corrección

Al reconstruir servicios de Búnker, `2jfitness-web-1` puede conservar la IP anterior del servicio API. El despliegue y el rollback ahora reinician ese contenedor después de levantar Búnker para que resuelva de nuevo el upstream.

El selftest ahora exige HTTP 200 y el cuerpo saludable en `/healthz` para Home y Búnker. Un HTTP 502 falla incluso si su cuerpo contiene accidentalmente `"ok"`.

## Verificación local

- `bash -n tooling/staging/setup-staging.sh`: PASS.
- `git diff --check`: PASS.
- Comprobación del parser de salud: HTTP 200 con `{"ok":true}` aceptado; HTTP 502 con el mismo cuerpo rechazado.
- No se conectó a staging ni se reinició ningún contenedor real.

## Pendiente

Esperar CI y revisión independiente en el PR de seguimiento antes de cualquier integración. No desplegar desde este cambio.
