# Endurecimiento del perímetro de producción — guía pendiente de aprobación

Estado: **documentación de preparación; no aplicada ni validada en servidor**. La configuración Caddy versionada hoy por Platform es la que genera `tooling/staging/setup-staging.sh` y es exclusiva de `2jfit.com` (staging). No existe en este repositorio un Caddyfile de producción que pueda modificarse o validarse. No copiar el Caddyfile ni el `docker-compose` de staging a producción.

## Límites de publicación

- En producción, publicar únicamente los hosts y rutas públicas aprobados para cada aplicación. No usar un `reverse_proxy` público genérico para `/api/*` como política definitiva.
- Mantener las APIs enlazadas a loopback o a una red privada; no publicar puertos de contenedores. Las llamadas Platform↔Búnker/otros servicios deben viajar por la red privada y seguir exigiendo la autenticación y firma servicio-a-servicio existentes.
- No enrutar a Internet las rutas internas `/api/internal/*`. Si un flujo necesita esas rutas, permitirlo solo por conectividad privada y controles de servicio; no crear una excepción pública en Caddy.
- No exponer rutas de salud internas ni paneles operativos. El `healthz` de staging es una comprobación del despliegue, no una ruta que deba publicarse por defecto en producción. Si se necesita monitorización externa, aprobar una ruta de salud mínima que no revele dependencias, configuración o datos.
- Las banderas de demostración/local (`LOCAL_DEMO_ROLE`, `LOCAL_DEMO_CLIENT_ID`, `STAGING_SEED`) deben permanecer ausentes en producción. El código restringe el rol local a `NODE_ENV=development`; el seed requiere además `STAGING_SEED=1` y `STAGING_SEED_HOST=2jfit.com`.

La lista anterior es una política de diseño, no una afirmación de que exista ya un Caddyfile de producción ni de que el perímetro esté desplegado.

## Identidad del propietario y promoción de privilegios

`ADMIN_PROMOTION_STEP_UP` **no existe como bandera o control implementado en este checkout**. No habilitar una variable con ese nombre ni considerar suficiente la autenticación ordinaria para elevar privilegios. Antes de abrir producción, documentar y probar una operación explícita de promoción que exija una nueva verificación passkey del propietario, limite el sujeto destino, audite actor/destino/resultado y falle cerrada si la verificación o auditoría falla. La asignación de `owner.panel.read` debe seguir la identidad de propietario configurada por el servidor, nunca un rol o campo elegido por el navegador. Esto requiere implementación y aceptación de seguridad separadas.

## Allowlist de IP por entorno (opcional)

- **Staging:** `ADMIN_ALLOW_IPS` ya se aplica al host Admin generado por el script de staging. Vacío significa denegación remota, no acceso abierto.
- **Producción:** si el propietario elige restringir el acceso por red, aplicar una allowlist en el perímetro del host Admin, separada por entorno y revisada contra la IP real que ve el proxy. La lista debe usar IP/CIDR estrechos; no usar `0.0.0.0/0` ni `::/0` como restricción. Si hay CDN/proxy, confiar solo en sus rangos documentados y preservar el origen real sin aceptar cabeceras reenviadas del cliente.
- La allowlist es defensa adicional y puede ser opcional según el entorno; **no sustituye passkeys ni autorización server-side**. No abrir Basic Auth/demo roles en producción. Antes de aplicar una allowlist, comprobar una ruta de recuperación administrativa y evitar bloquear al propietario.

No se ha añadido una variable de producción ni una configuración de proxy porque no hay configuración productiva versionada que se pueda probar con seguridad.

## Auditoría del servidor (auditd)

Antes de producción, el operador debe definir rutas reales y activar reglas persistentes mediante el proceso de cambio del servidor. Como punto de partida —**plantilla, no ejecutar desde este PR**— vigilar cambios de permisos/contenido en la configuración Caddy, configuración de Platform, unidades systemd y registro de releases:

```text
-w /etc/caddy/Caddyfile -p wa -k 2j_edge_config
-w /etc/2j-platform/ -p wa -k 2j_platform_config
-w /etc/systemd/system/ -p wa -k 2j_service_config
-w /opt/2j/releases.log -p wa -k 2j_release
```

Las rutas deben ajustarse al diseño real y limitarse a directorios concretos. No auditar contenido de secretos ni registrar valores de variables; preservar logs con acceso restringido, retención definida y sincronización horaria. Validar reglas, rotación, alertas y restauración en staging antes de cualquier uso productivo. Este PR no instala `auditd`, no cambia reglas del host y no accede a servidores.

## Token de lectura del repositorio Búnker para CI

`.github/workflows/e2e-training.yml` usa el secreto Actions `BUNKER_REPO_READ_TOKEN` solo para checkout del repositorio Búnker. Mantenerlo limitado a `2jfitnesscenter/2jfitnessapp`, permiso `Contents: read`, sin escritura y con expiración. La referencia operativa actual indica renovación **aproximada a mediados de enero de 2027**; la fecha real de expiración no es verificable desde el repositorio. El propietario debe comprobarla en GitHub y renovar antes de esa fecha. Nunca copiar el token a documentación, comandos, logs o artefactos.

## Verificación pendiente antes de producción

1. Diseñar y revisar la configuración Caddy de producción en su cambio específico, incluyendo rutas públicas exactas y bloqueo de `/api/internal/*` en la interfaz pública.
2. Implementar y probar el step-up de promoción de propietario; el control todavía no existe.
3. Acordar allowlist por entorno y probar recuperación de acceso si se activa.
4. Aplicar y validar auditd mediante cambio operativo aprobado.
5. Comprobar la caducidad y renovación del secreto Búnker desde GitHub.

No se han cambiado DNS, secretos, servidores, datos ni bases de datos reales.
