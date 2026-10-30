# Handoff — allowlist de IP de Admin

## Alcance

Endurecimiento del allowlist de staging ya existente y aclaración de su aislamiento por entorno. No se añadió una ruta ni se cambió autenticación/autorización de Platform. Se clasifica **Level 2** por afectar un control de perímetro de acceso; requiere una revisión independiente antes de poder fusionar.

## Implementado

- `tooling/staging/setup-staging.sh`: `ADMIN_ALLOW_IPS` se valida con `ipaddress.ip_network(..., strict=True)`, limita a 32 entradas y rechaza prefijos más amplios que `/24` IPv4 o `/64` IPv6 y redes con bits de host activos.
- El Admin de staging mantiene el matcher Caddy `remote_ip`: la ACL mira el peer directo y no autoriza por `X-Forwarded-For` ni `X-Real-IP`.
- `docs/runbooks/admin-ip-allowlist.md`: explica el valor omitido, el uso en staging y la separación de una configuración productiva futura. Passkeys y autorización server-side siguen siendo necesarias en producción.

## Validación

- Tests de staging y allowlist ejecutados en contenedor Linux con Bash/Python: 6/6 PASS.
- Casos: valor omitido, IP/CIDR válidos, CIDR inválidos/amplios/no canónicos y matcher sin confianza en cabeceras reenviadas.
- `bash -n tooling/staging/setup-staging.sh`: PASS.
- `git diff --check`: PASS.

## Límites

El allowlist productivo no se implementa porque el repo no contiene Caddyfile/configuración de producción. No se cambió ni desplegó Caddy activo, no se accedió a staging/producción y no se modificaron DNS, secretos ni bases de datos.
