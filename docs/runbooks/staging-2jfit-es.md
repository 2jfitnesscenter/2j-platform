# Runbook de STAGING — 2jfit.es (Contabo, Ubuntu 24.04)

**Esto NO es producción.** Solo datos de prueba, sin secretos reales, sin dinero real, sin push real, puerta fiscal cerrada, modo piloto. Nadie (ni yo, ni ningún agente) tiene acceso al servidor: lo ejecutas tú.

> **REGLA DURA:** este staging solo puede contener **datos sintéticos** (ningún cliente real, ninguna persona real, ningún pago real). El admin no tiene login de personal y solo es aceptable por eso. Si alguna vez fueran a entrar datos reales: PARAR; antes hace falta autenticación real de personal.

Antes de `deploy`: los 3 registros DNS deben apuntar ya a `169.58.20.25` (el script lo comprueba y se detiene si no).

Servidor: `169.58.20.25` · Dominios: `home.2jfit.es`, `app.2jfit.es`, `admin.2jfit.es` · Script: `tooling/staging/setup-staging.sh` (se puede ejecutar de nuevo sin romper nada).

## 0. Antes de empezar (lo que necesito de ti)
1. Tu **clave SSH pública** (una línea `ssh-ed25519 …`). Nunca la privada. Si no tienes: en tu PC, PowerShell: `ssh-keygen -t ed25519` y abre `C:\Users\juanj\.ssh\id_ed25519.pub`.
2. Tu **IP pública** (para abrir `admin.2jfit.es` solo a ti): busca «mi ip» en Google. Si la dejas vacía, admin queda cerrado a todo el mundo.
3. Un **e-mail** para avisos de certificado (opcional).
4. En el DNS de `2jfit.es`, **3 registros A** → `169.58.20.25`: `home`, `app`, `admin`.
5. Confirmar las ramas a desplegar (por defecto, vista previa de integración para Platform+Home y el consumidor V2.1 para Búnker).
6. Aceptar por escrito el riesgo de «Lo que debes saber» (ver abajo).

## 1. Subir el script
En tu PC (PowerShell), desde la carpeta del repo:
```
scp tooling/staging/setup-staging.sh root@169.58.20.25:/root/
```
**Verifica el hash ANTES de ejecutarlo.** En el servidor: `sha256sum /root/setup-staging.sh`. Debe ser idéntico al que te di en el PR/mensaje (se calcula sobre el fichero con saltos de línea LF). Compáralo también con el de GitHub: en tu PC `git show origin/agent/claude/2J-STAGING-SETUP:tooling/staging/setup-staging.sh | sha256sum` (o en PowerShell, desde la carpeta del repo: `Get-FileHash -Algorithm SHA256 tooling/staging/setup-staging.sh`). Si **no coincide, no lo ejecutes**. Además, el PR #89 debe tener su revisión independiente hecha antes de ejecutar nada.

## 2. Preparar y base (como root)
```
ssh root@169.58.20.25
apt-get update && apt-get install -y tmux && tmux new -s staging     # si se corta la conexión: ssh de nuevo y «tmux attach -t staging»
chmod +x setup-staging.sh
./setup-staging.sh init
nano /etc/2j-staging.conf      # pega SSH_PUBKEY, ADMIN_ALLOW_IPS, ACME_EMAIL; guarda: Ctrl+O, Enter, Ctrl+X
./setup-staging.sh base
```
`base` también copia el script a `/usr/local/sbin/2j-staging`: **a partir de aquí se usa `sudo 2j-staging …`** (la copia de `/root` deja de ser accesible cuando SSH queda solo para `ops`). Al terminar `base`, si se actualizó el kernel, reinicia (`reboot`) y vuelve a entrar. `base`: antes de activar el cortafuegos detecta el puerto SSH que realmente usa el servidor y lo permite (además del 22). Actualiza el sistema, crea el usuario `ops` con sudo, firewall (solo 22/80/443), fail2ban, actualizaciones de seguridad automáticas, Docker + Compose, Caddy. **SSH por contraseña/root sigue abierto a propósito.**

## 3. Cerrar SSH (solo si el login nuevo funciona)
0. **Ten abierta la consola VNC del panel de Contabo en una pestaña mientras cierras SSH** (es tu salida de emergencia si algo falla).
1. **Sin cerrar** la sesión, abre OTRA ventana: `ssh ops@169.58.20.25` → debe entrar **sin pedir contraseña**.
2. Si entra, en la primera ventana: `2j-staging lock-ssh --confirm` (comprueba por sí mismo que ya hubo un login real por clave de `ops`; si no lo ve, se niega). Si no entra, no sigas: avísame.
3. Si te quedas fuera: usa la **consola VNC** del panel de Contabo (entra como root con la contraseña del panel) y revierte con el comando de abajo.
4. Revertir si hace falta: `rm /etc/ssh/sshd_config.d/00-2j-hardening.conf && systemctl reload ssh`.

## 4. Llaves de despliegue de solo lectura
```
sudo 2j-staging deploykeys
```
Imprime **dos claves públicas**. En GitHub, en cada repo → *Settings → Deploy keys → Add* (**sin** marcar «Allow write access»): una en `2j-platform`, otra en `2jfitnessapp`. (Las privadas se quedan en el servidor, `chmod 600`.)

## 5. Desplegar, datos de prueba y autocomprobación
En `/etc/2j-staging.conf` pon `ACCEPT_ADMIN_WITHOUT_STAFF_AUTH="yes"` solo si aceptas el riesgo de abajo. Luego:
```
sudo 2j-staging deploy
sudo 2j-staging seed
sudo 2j-staging selftest
```
`selftest` imprime OK/FAIL por subdominio (DNS, HTTPS, salud), contenedores y seguridad, y termina en `RESULTADO: TODO OK` o `N FALLO(S)`.

**Acceso a las webs:** usuario `staging`; la contraseña está en `/opt/2j/secrets/basic-auth.txt` (solo root). El script **no la imprime**. Para leerla cuando la necesites, abre el fichero con `sudo less /opt/2j/secrets/basic-auth.txt` (sal con `q`), cópiala al gestor de contraseñas y no la pegues en chats ni correos. Las contraseñas de las bases se generan en el servidor (`chmod 600`) y no se imprimen ni se guardan en Git.

## 5b. Cambiar la IP permitida de `admin.`
Tu IP doméstica puede cambiar. Si `admin.2jfit.es` te da 403: mira tu IP nueva (busca «mi ip»), edita `sudo nano /etc/2j-staging.conf`, cambia `ADMIN_ALLOW_IPS="x.x.x.x"` (varias, separadas por espacio) y ejecuta `sudo 2j-staging deploy` (es repetible pero tarda unos minutos (reconstruye); regenera y valida el Caddyfile y solo lo instala y recarga si es válido). Si te quedas fuera por completo, entra por SSH y haz lo mismo. Vacío = admin cerrado a todos.

## 6. Datos de prueba
Personas sintéticas `@example.test` (miembros de prueba `member-a` y `member-b` con códigos piloto fijos de `seed-demo.ts`, solo válidos en este staging). Nada de datos reales.

## 7. Día a día
- Estado: `sudo 2j-staging status`
- Copia ahora: `sudo 2j-staging backup` (diaria automática, 7 días; en `/opt/2j/backups`)
- Restaurar Platform: `sudo 2j-staging restore-db /opt/2j/backups/<fichero>.dump`
- Actualizar código: cambia `PLATFORM_REF`/`BUNKER_REF` y `sudo 2j-staging deploy`
- **Rollback/borrado total:** `sudo 2j-staging teardown --yes` (te pide escribir `DESTRUIR STAGING`; no toca SSH/firewall/usuario).

## Comprobaciones que hace el script por ti
- `ADMIN_ALLOW_IPS` se valida: solo IPs correctas; rechaza `0.0.0.0/0`, `::/0` y máscaras muy anchas (mínimo /24 en IPv4, /64 en IPv6).
- `teardown` solo actúa sobre `/opt/2j` y te muestra la ruta exacta antes de pedir la frase.
- Las contraseñas no se pasan como argumentos de procesos (se leen por entrada estándar).

## Lo que debes saber (riesgos y límites)
1. **Platform aún no tiene login de personal.** El admin de staging usa un rol de demostración (`NODE_ENV=development`); lo único que lo protege es la contraseña básica + la lista de IP. Por eso `ADMIN_ALLOW_IPS` y la aceptación explícita. **No metas datos reales aquí.**
2. Las copias de seguridad están en el **mismo disco**: sirven para errores, no para perder el servidor.
3. Con contraseña básica, el manifiesto PWA y algunas pruebas de instalación pueden comportarse distinto que en producción.
4. Push real desactivado (sin VAPID), puerta fiscal cerrada, modo piloto activo, SSO/V2.1 de Búnker según la rama desplegada.
5. Lo que **no** he podido comprobar sin el servidor: DNS, emisión real de certificados, Docker en Ubuntu 24.04 real, descarga de repos con las deploy keys. Sí verificado en local: sintaxis, generación y validación de Caddyfile y compose, y construcción de la imagen de Platform.
6. Límites conocidos de la revisión independiente (aceptados en staging, pendientes de endurecer): las ramas desplegadas son mutables (se construye lo que haya en la rama; el script guarda el commit en `/opt/2j/last-*-commit`); imágenes Docker sin digest; sin protección CSRF por `Origin` en el admin (por eso la lista de IP y no abrir otras webs desde esa IP mientras lo usas); la cookie de sesión de miembro se emite sin `Secure` detrás del proxy; las copias están en el mismo disco.
