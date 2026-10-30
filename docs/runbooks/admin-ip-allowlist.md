# Allowlist opcional de red para Admin

Estado: la implementación ejecutable de este repositorio es **solo staging** (`tooling/staging/setup-staging.sh`). No hay configuración productiva de Caddy/allowlist versionada. No reutilices `/etc/2j-staging.conf` en producción ni trates este documento como autorización para cambiar el servidor.

## Staging

El script ya restringe `admin.2jfit.com` al peer loopback y a las IP/CIDR enumeradas en `ADMIN_ALLOW_IPS`. La variable vive únicamente en `/etc/2j-staging.conf`:

```sh
ADMIN_ALLOW_IPS="83.57.105.60 2001:db8:abcd::/64"
```

Vacío (valor predeterminado) permite solo loopback y devuelve 403 al acceso remoto. Para cambiar la lista se edita el archivo en staging y se vuelve a ejecutar el deploy aprobado de staging; este cambio no lo ejecuta. La validación rechaza IP/CIDR inválidos, prefijos IPv4 más amplios que `/24`, prefijos IPv6 más amplios que `/64`, redes con bits de host activos y más de 32 entradas.

El matcher de Caddy es `remote_ip`, que comprueba el peer TCP directo. No toma la decisión a partir de `X-Forwarded-For` o `X-Real-IP`; esos encabezados no deben habilitar acceso. La lista de red no reemplaza autenticación. Staging mantiene su aislamiento y autenticación de demostración separados; **no es un patrón para producción**.

## Producción

La allowlist de producción es optativa por entorno y no está implementada aquí. Si se decide activarla, configurarla en el proxy/perímetro productivo mediante una configuración propia de producción, revisando qué peer ve realmente Caddy y preservando una ruta de recuperación. No confiar en cabeceras reenviadas salvo una cadena de proxies confiables validada. La autenticación por passkey y la autorización backend siguen siendo obligatorias aunque la IP esté permitida. Sin allowlist, el host Admin debe continuar protegido por passkeys, autorización backend, TLS y los controles de abuso acordados; nunca habilitar roles demo/Basic Auth.

Los tests del script verifican la validación de IP/CIDR y que el matcher del Admin use el peer directo sin leer encabezados reenviados. No se ha probado Caddy en un servidor ni se ha cambiado una configuración activa.
