# Runbook de STAGING — 2jfit.es (Contabo, Ubuntu 24.04)

**Esto NO es producción.** Solo datos de prueba, sin secretos reales, sin dinero real, sin push real, puerta fiscal cerrada, modo piloto. Nadie (ni yo, ni ningún agente) tiene acceso al servidor: lo ejecutas tú.

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
Comprueba que es el que revisaste: en el servidor `sha256sum /root/setup-staging.sh` debe dar el hash que figura en el PR.

## 2. Preparar y base (como root)
```
ssh root@169.58.20.25
chmod +x setup-staging.sh
./setup-staging.sh init
nano /etc/2j-staging.conf      # pega SSH_PUBKEY, ADMIN_ALLOW_IPS, ACME_EMAIL; guarda: Ctrl+O, Enter, Ctrl+X
./setup-staging.sh base
```
`base`: actualiza el sistema, crea el usuario `ops` con sudo, firewall (solo 22/80/443), fail2ban, actualizaciones de seguridad automáticas, Docker + Compose, Caddy. **SSH por contraseña/root sigue abierto a propósito.**

## 3. Cerrar SSH (solo si el login nuevo funciona)
1. **Sin cerrar** la sesión, abre OTRA ventana: `ssh ops@169.58.20.25` → debe entrar **sin pedir contraseña**.
2. Si entra, en la primera ventana: `./setup-staging.sh lock-ssh --confirm`. Si no entra, no sigas: avísame.
3. Revertir si hace falta: `rm /etc/ssh/sshd_config.d/00-2j-hardening.conf && systemctl reload ssh`.

## 4. Llaves de despliegue de solo lectura
```
sudo ./setup-staging.sh deploykeys
```
Imprime **dos claves públicas**. En GitHub, en cada repo → *Settings → Deploy keys → Add* (**sin** marcar «Allow write access»): una en `2j-platform`, otra en `2jfitnessapp`. (Las privadas se quedan en el servidor, `chmod 600`.)

## 5. Desplegar, datos de prueba y autocomprobación
En `/etc/2j-staging.conf` pon `ACCEPT_ADMIN_WITHOUT_STAFF_AUTH="yes"` solo si aceptas el riesgo de abajo. Luego:
```
sudo ./setup-staging.sh deploy
sudo ./setup-staging.sh seed
sudo ./setup-staging.sh selftest
```
`selftest` imprime OK/FAIL por subdominio (DNS, HTTPS, salud), contenedores y seguridad, y termina en `RESULTADO: TODO OK` o `N FALLO(S)`.

**Acceso a las webs:** usuario `staging`, contraseña en `/opt/2j/secrets/basic-auth.txt` (`sudo cat /opt/2j/secrets/basic-auth.txt`). Las contraseñas de las bases se generan en el servidor (`chmod 600`) y no se imprimen ni se guardan en Git.

## 6. Datos de prueba
Personas sintéticas `@example.test` (miembros de prueba `member-a` y `member-b` con códigos piloto fijos de `seed-demo.ts`, solo válidos en este staging). Nada de datos reales.

## 7. Día a día
- Estado: `sudo ./setup-staging.sh status`
- Copia ahora: `sudo ./setup-staging.sh backup` (diaria automática, 7 días; en `/opt/2j/backups`)
- Restaurar Platform: `sudo ./setup-staging.sh restore-db /opt/2j/backups/<fichero>.dump`
- Actualizar código: cambia `PLATFORM_REF`/`BUNKER_REF` y `sudo ./setup-staging.sh deploy`
- **Rollback/borrado total:** `sudo ./setup-staging.sh teardown --yes` (te pide escribir `DESTRUIR STAGING`; no toca SSH/firewall/usuario).

## Lo que debes saber (riesgos y límites)
1. **Platform aún no tiene login de personal.** El admin de staging usa un rol de demostración (`NODE_ENV=development`); lo único que lo protege es la contraseña básica + la lista de IP. Por eso `ADMIN_ALLOW_IPS` y la aceptación explícita. **No metas datos reales aquí.**
2. Las copias de seguridad están en el **mismo disco**: sirven para errores, no para perder el servidor.
3. Con contraseña básica, el manifiesto PWA y algunas pruebas de instalación pueden comportarse distinto que en producción.
4. Push real desactivado (sin VAPID), puerta fiscal cerrada, modo piloto activo, SSO/V2.1 de Búnker según la rama desplegada.
5. Lo que **no** he podido comprobar sin el servidor: DNS, emisión real de certificados, Docker en Ubuntu 24.04 real, descarga de repos con las deploy keys. Sí verificado en local: sintaxis, generación y validación de Caddyfile y compose, y construcción de la imagen de Platform.
