# Segunda revisión independiente de #89 (texto íntegro del revisor)

Revisión de `6172c24..51377cb`. Revisor: agente distinto del autor, solo lectura. Estado posterior: los tres arreglos mínimos se aplicaron en `b6f018d` (script SHA-256 `06dd25945d69cc86d2760232218c5672471358e60eeb3c84695c275ee6f16ca6`); esa corrección **no** ha sido revisada de nuevo.

---

**Revisión de `6172c24..51377cb` (PR #89): el script no es seguro para ejecutar tal cual, por tres defectos pequeños con arreglo de una o dos líneas.**

He comprobado lo siguiente:
- `bash -n` pasa.
- shellcheck solo da avisos informativos (SC2086 en la línea 125, que es casi cosmético, y SC2015 en `selftest`).
- `render` en `temp\review-89b` funciona y `caddy validate` (docker `caddy:2`) da "Valid configuration".
- El hash `htpasswd -niB` (`$2y$05$…`) lo acepta Caddy. Lo probé en un Caddy real: la contraseña correcta devuelve 200 y la incorrecta 401. La entrada `abc123\n` por stdin se hashea sin el salto de línea.

## Hallazgos anteriores

| Hallazgo | Veredicto | Comentario |
|---|---|---|
| P1 UFW sin el puerto SSH activo | Parcial | `sshd -T` sí detecta el puerto. El segundo origen, `ss -ltnH \| awk '/sshd/'`, nunca coincide, porque sin `-p` `ss` no muestra el nombre del proceso (línea 124). Con el puerto de sshd_config basta; con `ssh.socket` en 24.04 y un puerto distinto no se cubre. |
| P1 teardown con `rm -rf` sobre un root cambiado | Corregido | La línea 627 exige `ROOT == /opt/2j`, y las líneas 628 y 639 siguen protegiendo. |
| P2 Get-FileHash del runbook | Corregido | La ruta ya es `tooling/staging/setup-staging.sh`. |
| P2 `sudo cat` de la contraseña de Basic Auth | Corregido | Ahora usa `sudo less`. La contraseña sigue saliendo por pantalla al leerla, pero ya no queda en el historial como salida de `cat`. |
| P2 restore-db borraba la base antes de validar | Corregido | Ahora valida con `pg_restore -l`, pide confirmar y hace copia previa antes del `DROP`. Queda un riesgo menor: si `pg_restore` falla a medias, las APIs quedan paradas y la base a medias, aunque existe la copia previa. |
| P2 secretos como argumentos de proceso | Corregido | `htpasswd -niB` lee por stdin, `curl -K <(printf …)` usa `printf` (builtin) y la contraseña de `platform_app` va por stdin a `psql`. |
| P2 ADMIN_ALLOW_IPS sin validar | Corregido | Vacío pasa, `0.0.0.0/0` y `::/0` se rechazan, y IPv4 exige mínimo /24 e IPv6 mínimo /64. IPv4 mapeado en IPv6 se rechaza por el `.` y las cadenas hexadecimales raras las para `caddy validate`. Solo se llama desde `deploy`, no desde `render`. |
| H1 `Host 127.0.0.1:<puerto>` | Corregido | Está en todos los `reverse_proxy` de Platform: `/healthz`, `/health` y `/api`, en home y en admin. |
| H2 base `2j_demo` | Corregido | `DATABASE_URL`, `CREATE DATABASE` y el backup usan `2j_demo`, y coincide con el guard de `seed-demo.ts:273`. |
| H3 copia en `/usr/local/sbin/2j-staging` | Corregido, con un fallo al repetir (ver Media 3) | |
| M1 lock-ssh exige login por clave de ops | Corregido en lo esencial, con un fallo intermitente (ver Media 2) | `${2:-}` con `lock-ssh --confirm` funciona. |
| M7 precheck de DNS | Corregido en lo esencial, con un fallo (ver Media 1) | |
| M8 Caddyfile validado antes de instalar | Corregido | La validación en línea 509 va antes del `cp` y del `reload`. |
| M4 backup con fichero temporal y `pg_restore -l` | Corregido | El escape del heredoc (`\$tmp`, `\${stamp}`, `\(`) es correcto, y `${ROOT}` se expande al instalar, como se pretende. |

## Hallazgos nuevos

**Alta:** ninguno.

**Media**
1. **Líneas 456 y 587: el precheck de DNS aborta sin mensaje.** `ips="$(getent … | awk … | sort -u | tr …)"` con `pipefail` y `set -e`: si el nombre no resuelve, `getent` devuelve 2 y el script sale en silencio, sin llegar al `die` con el texto amable. Es seguro porque no sigue, pero el aviso no aparece. En `selftest` aborta en lugar de contar un FAIL. Arreglo: añadir `|| true` dentro de la sustitución.
2. **Línea 188: carrera de `pipefail` en lock-ssh.** `! journalctl … | grep -q …`: si `grep -q` sale al primer acierto y `journalctl` sigue escribiendo, recibe SIGPIPE y el pipeline devuelve 141. El `!` lo convierte en "no hay login" aunque exista. Falla cerrando (no bloquea el acceso), pero con un journal grande de intentos de bots puede negarse sin motivo. Arreglo: `out=$(journalctl … || true); grep -q <<<"$out"`, o `grep -c … >/dev/null`.
3. **Línea 166: `base` no se puede repetir.** Si se vuelve a ejecutar `2j-staging base` desde la copia instalada, `install` origen = destino falla con "are the same file" y `set -e` aborta antes del paso 8. Va contra "se puede ejecutar de nuevo". Arreglo: saltar la copia si `readlink -f "$0"` ya es `/usr/local/sbin/2j-staging`. Además, `deploy` no actualiza esa copia, así que `ops` puede ejecutar una versión vieja si solo se sube un script nuevo a `/root`.

**Baja**
- **Línea 124:** usar `$SSH_CONNECTION` (4.º campo) daría el puerto real de la sesión y es más fiable que `ss` sin `-p`.
- **Línea 247:** `[ -n "$ba_hash" ] || ba_hash="$(…)"` queda en una lista `||`, así que `set -e` no se activa si `htpasswd` falla. Dejaría un hash vacío y lo pararía `caddy validate`, que es seguro, pero con un mensaje confuso.
- **Línea 496:** `… | grep -q 1 || CREATE DATABASE` tiene el mismo riesgo de SIGPIPE con `pipefail`. Es improbable con una sola línea de salida, pero si ocurriera, `CREATE DATABASE` fallaría por existir ya la base.
- **Línea 48:** `case "$ROOT" in /opt/?*|/tmp/?*)` admite `/opt/../etc`. Solo es aprovechable por quien ya sea root, y tests con `TWOJ_ROOT` en una ruta fuera de `/opt` o `/tmp` (por ejemplo `C:\…`) morirán.
- **Líneas 530–537:** si `pg_dump` falla, el `.tmp` oculto no se limpia ni lo cubre el `find -delete`, y los `pre-restore-*.dump` tampoco se purgan.
- **Línea 564:** el `pg_dump` previo a restaurar no se valida con `pg_restore -l`.
- **Sin cambios, pero relevante:** el sitio admin no reescribe el `Origin`, mientras que el de home sí. Con `CORS_ORIGIN` en loopback, las peticiones de escritura de la web de admin desde `https://admin…` pueden recibir rechazo del API. No lo verifiqué contra el código. El punto 6 del runbook ya menciona que no hay protección CSRF por `Origin` en el admin.

## Veredicto

**¿Seguro para ejecutar tal cual? No del todo.** No he encontrado nada que pueda dejarte sin acceso o destruir datos. Los tres defectos son de robustez y de repetibilidad, y los dos primeros fallan cerrando. El tercero solo afecta a repetir `base`.

Antes de ejecutar, mínimo:
1. Añadir `|| true` en la resolución de DNS (líneas 456 y 587).
2. Cambiar el pipeline de `journalctl` de lock-ssh para evitar el SIGPIPE (línea 188).
3. Saltar el `install` en la línea 166 cuando origen y destino son el mismo fichero.

Si lo ejecutas sin esos arreglos, funciona en el primer pase de `base`, `lock-ssh` y `deploy`, con estos riesgos:
- **DNS:** si no resuelve, no sale el mensaje claro.
- **lock-ssh:** puede negarse una vez de forma intermitente.
- **base:** al repetirla falla.

Opcional: sustituir la detección de puerto con `ss` por `$SSH_CONNECTION`. Si cambias el script, el SHA-256 pasa a ser otro y hay que recalcularlo.

Qué no se comprobó: no se ejecutó el script, ni `docker build`, ni `docker compose config` del compose renderizado; no hay `shellcheck` ni `caddy` nativos; comportamiento real en Ubuntu 24.04; emisión de certificados y DNS.
