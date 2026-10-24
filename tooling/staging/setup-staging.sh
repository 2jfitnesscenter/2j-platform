#!/usr/bin/env bash
# 2J STAGING — one idempotent setup script for a NEW Ubuntu 24.04 server (home. / app. / admin. under one staging domain).
#
#   HARD RULE: this server may hold ONLY SYNTHETIC test data (no real clients, no real people, no real payments). Its admin has no staff login yet, so it is
#   acceptable ONLY because of that. The day any real person's data would enter, STOP: the admin must be behind real authentication first.
#   THIS SERVER IS NOT PRODUCTION. It must never hold production data, secrets, databases or tokens. Everything it uses is generated here, on the server.
#   Nobody but the person who runs this script ever sees the server or its secrets (no secret is passed in, printed, logged or committed).
#
# Usage (as root over SSH; read docs/runbooks/staging-2jfit-es.md first):
#   setup-staging.sh init          create /etc/2j-staging.conf (the only file you edit)
#   setup-staging.sh base          update system, user, firewall, fail2ban, auto-updates, Docker, Caddy  (SSH stays open on purpose)
#   setup-staging.sh lock-ssh --confirm   after you tested the new login: key-only SSH, no root, no passwords
#   setup-staging.sh deploykeys    make two read-only deploy keys and print their PUBLIC halves
#   setup-staging.sh deploy        fetch the code, build, create databases, start everything, HTTPS
#   setup-staging.sh seed          load synthetic test data only
#   setup-staging.sh selftest      OK / FAIL per subdomain and per safety check
#   setup-staging.sh status        what is running
#   setup-staging.sh backup        one backup now (a daily one is installed by `deploy`)
#   setup-staging.sh restore-db FILE   restore the Platform database from a backup file
#   setup-staging.sh teardown --yes    destroy the staging stack (asks you to type a phrase)
#   setup-staging.sh render DIR    write the generated config files to DIR with fake secrets (used by tests; touches nothing else)
#
# Every subcommand can be run again safely.

set -Eeuo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive

CONF=/etc/2j-staging.conf
ROOT="${TWOJ_ROOT:-/opt/2j}"          # overridable only for tests
LOG=/var/log/2j-staging-setup.log

# ----------------------------------------------------------------------------------------------------------------------------------------------------
# defaults (overridden by /etc/2j-staging.conf)
SERVER_IP="169.58.20.25"
DOMAIN="2jfit.es"
OPS_USER="ops"
SSH_PUBKEY=""                       # REQUIRED for `base`: your PUBLIC key (one line starting with ssh-ed25519 or ssh-rsa). Never a private key.
ACME_EMAIL=""                       # optional: where Let's Encrypt can warn you about an expiring certificate
ADMIN_ALLOW_IPS=""                  # optional, space separated: your own public IPs/CIDRs. Empty = admin.<domain> answers 403 to everyone but the server itself.
PLATFORM_REPO="git@github.com:2jfitnesscenter/2j-platform.git"
BUNKER_REPO="git@github.com:2jfitnesscenter/2jfitnessapp.git"
PLATFORM_REF="agent/claude/2J-INTEGRATION-PREVIEW"      # ASSUMED: Home+SSO+push+main. Change to `main` for what is merged.
BUNKER_REF="agent/claude/2J-V21-BUNKER-CONSUMER"        # ASSUMED: Búnker with the Platform consumer (SSO/V2.1 off by default).
ACCEPT_ADMIN_WITHOUT_STAFF_AUTH="no"                    # must be "yes": Platform has no staff login yet (see runbook, section "Lo que debes saber").
BACKUP_KEEP_DAYS=7
[ -f "$CONF" ] && . "$CONF"
case "$ROOT" in /opt/?*|/tmp/?*) ;; *) echo "ROOT debe estar bajo /opt/ (valor: '$ROOT')" >&2; exit 1;; esac

HOSTS_HOME="home.${DOMAIN}"; HOSTS_APP="app.${DOMAIN}"; HOSTS_ADMIN="admin.${DOMAIN}"
BUNKER_LOCAL_PORT=18080; PLATFORM_ADMIN_PORT=3100; PLATFORM_MEMBER_PORT=3102

say()  { printf '\n==> %s\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
warn() { printf '  AVISO %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || die "Ejecuta este script como root (sudo -i)."; }
FAILS=0
log_start() { mkdir -p "$(dirname "$LOG")"; touch "$LOG"; chmod 600 "$LOG"; exec > >(tee -a "$LOG") 2>&1; }   # secrets are never echoed, so the log holds none

gen_secret() { openssl rand -hex 24; }                       # 48 hex chars; used for passwords (hex => safe inside URLs)
secret_file() { [ -f "$1" ] || { gen_secret > "$1"; chmod 600 "$1"; }; }

# ----------------------------------------------------------------------------------------------------------------------------------------------------
cmd_init() {
  need_root
  if [ -f "$CONF" ]; then say "$CONF ya existe (no se toca). Edítalo con: nano $CONF"; return; fi
  cat > "$CONF" <<EOF
# 2J staging — the only file you edit. Lines starting with # are comments.
SERVER_IP="${SERVER_IP}"
DOMAIN="${DOMAIN}"
OPS_USER="${OPS_USER}"

# REQUIRED before 'base': your PUBLIC SSH key, one line (starts with ssh-ed25519 or ssh-rsa). NEVER paste a private key.
SSH_PUBKEY=""

# Optional: an e-mail for certificate warnings.
ACME_EMAIL=""

# Optional: your own public IP(s), space separated, to open admin.${DOMAIN} to you. Empty = admin stays closed.
ADMIN_ALLOW_IPS=""

# Which code to deploy (branch names). Change only if told to.
PLATFORM_REF="${PLATFORM_REF}"
BUNKER_REF="${BUNKER_REF}"

# Platform has no staff login yet: its admin runs with a built-in demo role, protected only by the password + IP list below.
# Write yes ONLY after reading section "Lo que debes saber" of the runbook.
ACCEPT_ADMIN_WITHOUT_STAFF_AUTH="no"
EOF
  chmod 600 "$CONF"
  say "Creado $CONF. Ábrelo con: nano $CONF   (rellena SSH_PUBKEY; guarda con Ctrl+O, Enter, Ctrl+X)"
}

# ----------------------------------------------------------------------------------------------------------------------------------------------------
cmd_base() {
  need_root; log_start
  case "$SSH_PUBKEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *) die "Falta SSH_PUBKEY en $CONF (tu clave PÚBLICA, empieza por ssh-ed25519 o ssh-rsa).";; esac
  case "$SSH_PUBKEY" in *PRIVATE*) die "Eso parece una clave PRIVADA. No la pegues nunca. Pega solo la pública.";; esac
  [ -r /etc/os-release ] && . /etc/os-release
  [ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = "24.04" ] || die "Este script es para Ubuntu 24.04 (este servidor es ${PRETTY_NAME:-desconocido})."

  say "1/8 Actualizando el sistema (puede tardar unos minutos)"
  apt-get update -y
  apt-get -y -o Dpkg::Options::=--force-confold upgrade
  apt-get install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades jq openssl sudo cron dnsutils python3-systemd apache2-utils
  timedatectl set-timezone Atlantic/Canary || true
  systemctl enable --now systemd-timesyncd >/dev/null 2>&1 || true     # service-to-service signatures need a correct clock

  say "2/8 Usuario ${OPS_USER} con sudo y acceso solo por clave"
  id "$OPS_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$OPS_USER"
  usermod -aG sudo "$OPS_USER"
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$OPS_USER" > "/etc/sudoers.d/90-2j-${OPS_USER}"; chmod 440 "/etc/sudoers.d/90-2j-${OPS_USER}"
  visudo -cf "/etc/sudoers.d/90-2j-${OPS_USER}" >/dev/null
  install -d -m 700 -o "$OPS_USER" -g "$OPS_USER" "/home/${OPS_USER}/.ssh"
  touch "/home/${OPS_USER}/.ssh/authorized_keys"; chmod 600 "/home/${OPS_USER}/.ssh/authorized_keys"; chown "$OPS_USER:$OPS_USER" "/home/${OPS_USER}/.ssh/authorized_keys"
  grep -qxF "$SSH_PUBKEY" "/home/${OPS_USER}/.ssh/authorized_keys" || printf '%s\n' "$SSH_PUBKEY" >> "/home/${OPS_USER}/.ssh/authorized_keys"
  ok "Clave instalada para ${OPS_USER}. SSH por contraseña/root SIGUE abierto hasta que ejecutes 'lock-ssh' (paso aparte, a propósito)."

  say "3/8 Cortafuegos (UFW): solo 22, 80 y 443"
  ufw default deny incoming; ufw default allow outgoing
  # Allow the port sshd REALLY listens on (and 22) BEFORE enabling the firewall: enabling it first on a non-standard port would cut this very session.
  ssh_ports="22 $(sshd -T 2>/dev/null | awk '$1=="port"{print $2}') $(printf '%s' "${SSH_CONNECTION:-}" | awk '{print $4}')"
  for p in $(printf '%s\n' $ssh_ports | sort -un); do case "$p" in ''|*[!0-9]*) continue;; esac; ufw allow "${p}/tcp" >/dev/null; ok "SSH permitido en el puerto ${p}"; done
  ufw allow 80/tcp; ufw allow 443/tcp
  ufw --force enable

  say "4/8 fail2ban"
  cat > /etc/fail2ban/jail.d/2j-sshd.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
  systemctl enable --now fail2ban; systemctl restart fail2ban

  say "5/8 Actualizaciones de seguridad automáticas (sin reinicio automático)"
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
  systemctl enable --now unattended-upgrades

  say "6/8 Docker + Compose (repositorio oficial de Docker)"
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc; chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
  # Docker bypasses UFW for published ports, so this stack never publishes a port on a public address (everything binds to 127.0.0.1).
  install -d -m 755 /etc/docker
  [ -f /etc/docker/daemon.json ] || printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "5" }\n}\n' > /etc/docker/daemon.json
  systemctl restart docker

  say "7/8 Caddy (HTTPS automático, repositorio oficial)"
  if ! command -v caddy >/dev/null 2>&1; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y; apt-get install -y caddy
  fi
  systemctl enable caddy

  [ "$(readlink -f "$0")" = /usr/local/sbin/2j-staging ] || install -m 755 "$(readlink -f "$0")" /usr/local/sbin/2j-staging      # readable by ${OPS_USER} after SSH is locked (a copy in /root is not)

  say "8/8 Estructura de carpetas"
  install -d -m 755 "$ROOT" "$ROOT/src" "$ROOT/build" "$ROOT/compose" "$ROOT/www/home" "$ROOT/www/admin"
  install -d -m 700 "$ROOT/secrets" "$ROOT/backups" "$ROOT/pgdata"

  cat <<EOF

============================================================================================================
 BASE LISTA. Ahora, SIN cerrar esta sesión:
   1. Abre OTRA ventana y prueba:   ssh ${OPS_USER}@${SERVER_IP}      (debe entrar sin pedirte contraseña)
   2. Solo si entra, vuelve aquí y ejecuta:   2j-staging lock-ssh --confirm
   Si no entra, NO cierres esta sesión: avísame.
============================================================================================================
EOF
}

cmd_lock_ssh() {
  need_root
  local force=no; [ "${2:-}" = "--force" ] && force=yes
  [ "${1:-}" = "--confirm" ] || die "Escribe: 2j-staging lock-ssh --confirm   (solo después de comprobar en otra ventana que ssh ${OPS_USER}@${SERVER_IP} entra sin contraseña)."
  [ -s "/home/${OPS_USER}/.ssh/authorized_keys" ] || die "${OPS_USER} no tiene ninguna clave instalada: ejecuta primero 'base'."
  local ssh_log; ssh_log="$(journalctl -u ssh --no-pager 2>/dev/null || true)"
  if [ "$force" != yes ] && ! grep -q "Accepted publickey for ${OPS_USER} " <<<"$ssh_log"; then
    die "No veo ningún login por CLAVE de ${OPS_USER} en el registro de SSH. Entra primero desde otra ventana con: ssh ${OPS_USER}@${SERVER_IP} y repite. (Solo si estás seguro: lock-ssh --confirm --force. Rescate si te quedas fuera: consola VNC del panel de Contabo.)"
  fi
  # Ubuntu 24.04 reads /etc/ssh/sshd_config.d/*.conf in alphabetical order and the FIRST value wins, so ours is named 00-.
  cat > /etc/ssh/sshd_config.d/00-2j-hardening.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers ${OPS_USER}
MaxAuthTries 3
EOF
  sshd -t || { rm -f /etc/ssh/sshd_config.d/00-2j-hardening.conf; die "La configuración de SSH no es válida; revertida. No se ha cambiado nada."; }
  systemctl reload ssh
  cat <<EOF

SSH endurecido: ya no se puede entrar como root ni con contraseña. Esta sesión sigue viva.
ANTES de cerrarla, abre otra ventana y comprueba:  ssh ${OPS_USER}@${SERVER_IP}
Si falla, aquí mismo puedes revertir con:  rm /etc/ssh/sshd_config.d/00-2j-hardening.conf && systemctl reload ssh
EOF
}

# ----------------------------------------------------------------------------------------------------------------------------------------------------
cmd_deploykeys() {
  need_root
  install -d -m 700 "$ROOT/secrets"
  for name in platform bunker; do
    key="$ROOT/secrets/deploy_${name}"
    [ -f "$key" ] || ssh-keygen -q -t ed25519 -N "" -C "2j-staging-${name}-readonly" -f "$key"
  done
  cat <<EOF

Estas dos líneas son claves PÚBLICAS (se pueden compartir). Añade cada una como «Deploy key» de SOLO LECTURA en GitHub
(repositorio -> Settings -> Deploy keys -> Add deploy key; deja DESMARCADO «Allow write access»):

--- 2j-platform  (repositorio ${PLATFORM_REPO}) ---
$(cat "$ROOT/secrets/deploy_platform.pub")

--- 2jfitnessapp (repositorio ${BUNKER_REPO}) ---
$(cat "$ROOT/secrets/deploy_bunker.pub")

Cuando estén añadidas, ejecuta:  2j-staging deploy
EOF
}

git_sync() {  # name repo ref dest
  local name="$1" repo="$2" ref="$3" dest="$4" key="$ROOT/secrets/deploy_$1"
  [ -f "$key" ] || die "Faltan las claves de despliegue: ejecuta '2j-staging deploykeys' y añádelas en GitHub."
  export GIT_SSH_COMMAND="ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$ROOT/secrets/known_hosts"
  git ls-remote --exit-code "$repo" "refs/heads/$ref" >/dev/null 2>&1 || die "No puedo leer ${repo} (rama ${ref}). ¿Añadiste la deploy key de solo lectura? ¿Existe la rama?"
  if [ -d "$dest/.git" ]; then git -C "$dest" fetch --quiet origin "$ref"; else git clone --quiet "$repo" "$dest"; git -C "$dest" fetch --quiet origin "$ref"; fi
  git -C "$dest" checkout --quiet --detach FETCH_HEAD
  printf '  %s -> %s\n' "$name" "$(git -C "$dest" rev-parse --short HEAD)"
}

# ----------------------------------------------------------------------------------------------------------------------------------------------------
render_files() {  # DIR  — generated config; reads secrets from $ROOT/secrets unless RENDER_FAKE=1
  local dir="$1"; mkdir -p "$dir"
  local ba_hash="${FAKE_BASIC_HASH:-}"
  if [ -z "$ba_hash" ]; then ba_hash="$(htpasswd -niB staging < "$ROOT/secrets/basic-auth.pass" | cut -d: -f2)"; [ -n "$ba_hash" ] || die "No se pudo generar el hash de la contraseña (¿está instalado apache2-utils?)"; fi   # password read from stdin: never in ps
  local allow="127.0.0.1 ::1 ${ADMIN_ALLOW_IPS}"
  local email_block=""; [ -n "$ACME_EMAIL" ] && email_block="	email ${ACME_EMAIL}"

  cat > "$dir/Caddyfile" <<EOF
{
${email_block}
}

(guard) {
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		X-Robots-Tag "noindex, nofollow"
		-Server
	}
	basic_auth {
		staging ${ba_hash}
	}
}

# Home (members). /api goes to the member API; the browser's Origin is rewritten ONLY when it is exactly this site, because the API insists on a loopback origin.
${HOSTS_HOME} {
	import guard
	handle /healthz {
		rewrite * /health
		reverse_proxy 127.0.0.1:${PLATFORM_MEMBER_PORT} {
			header_up Host 127.0.0.1:${PLATFORM_MEMBER_PORT}
		}
	}
	@homeOrigin header Origin https://${HOSTS_HOME}
	handle /api/* {
		request_header @homeOrigin Origin http://127.0.0.1:5173
		reverse_proxy 127.0.0.1:${PLATFORM_MEMBER_PORT} {
			header_up Host 127.0.0.1:${PLATFORM_MEMBER_PORT}
		}
	}
	handle {
		root * ${ROOT}/www/home
		try_files {path} /index.html
		file_server
	}
}

# Platform admin. Closed to everyone except this server and the IPs in ADMIN_ALLOW_IPS (the API has a built-in demo admin role: it must never face the open internet).
${HOSTS_ADMIN} {
	@denied not remote_ip ${allow}
	handle @denied {
		respond "admin cerrado (staging)" 403
	}
	handle {
		import guard
		handle /healthz {
			rewrite * /health
			reverse_proxy 127.0.0.1:${PLATFORM_ADMIN_PORT} {
				header_up Host 127.0.0.1:${PLATFORM_ADMIN_PORT}
			}
		}
		handle /health {
			reverse_proxy 127.0.0.1:${PLATFORM_ADMIN_PORT} {
				header_up Host 127.0.0.1:${PLATFORM_ADMIN_PORT}
			}
		}
		handle /api/* {
			reverse_proxy 127.0.0.1:${PLATFORM_ADMIN_PORT} {
				header_up Host 127.0.0.1:${PLATFORM_ADMIN_PORT}
			}
		}
		handle {
			root * ${ROOT}/www/admin
			try_files {path} /index.html
			file_server
		}
	}
}

# Búnker (its own passkey login; invite-only; the AI coach is off).
${HOSTS_APP} {
	import guard
	handle /healthz {
		rewrite * /api/health
		reverse_proxy 127.0.0.1:${BUNKER_LOCAL_PORT}
	}
	reverse_proxy 127.0.0.1:${BUNKER_LOCAL_PORT}
}
EOF

  cat > "$dir/Dockerfile.platform" <<'EOF'
# Builds Platform (API + admin + Home) from the cloned repository. Nothing here contains a secret.
FROM node:24-bookworm-slim
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@2j/api..." build
ARG ADMIN_ORIGIN
ARG HOME_ORIGIN
ARG BUNKER_ORIGIN
RUN VITE_API_URL="${ADMIN_ORIGIN}" pnpm --filter "@2j/admin-web..." build
RUN VITE_2J_PILOT_MEMBER_LOGIN=true VITE_2J_ADMIN_URL="${ADMIN_ORIGIN}" VITE_2J_TRAINING_URL="${BUNKER_ORIGIN}" pnpm --filter "@2j/client-app..." build
EOF
  cat > "$dir/Dockerfile.platform.dockerignore" <<'EOF'
.git
**/node_modules
**/dist
**/.turbo
**/.env
**/.env.*
EOF

  cat > "$dir/platform.compose.yml" <<EOF
# STAGING ONLY. The Platform APIs only listen on 127.0.0.1 (the code refuses anything else), so they use the host network namespace.
name: 2j-platform-staging
services:
  postgres:
    image: postgres:17-alpine
    container_name: 2j-postgres
    restart: unless-stopped
    env_file: ${ROOT}/secrets/postgres.env
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - ${ROOT}/pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 20

  platform-admin-api:
    image: 2j-platform:staging
    container_name: 2j-platform-admin-api
    restart: unless-stopped
    network_mode: host
    working_dir: /repo
    command: ["node", "apps/api/dist/server.js"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ${ROOT}/secrets/platform-db.env
    environment:
      NODE_ENV: development               # Platform only allows its pilot/demo modes here (see runbook)
      HOST: 127.0.0.1
      PORT: "${PLATFORM_ADMIN_PORT}"
      LOCAL_DEMO_ROLE: admin
      CORS_ORIGIN: http://127.0.0.1:5174
      PILOT_MEMBER_COHORT_MANAGEMENT_ENABLED: "true"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:${PLATFORM_ADMIN_PORT}/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5

  platform-member-api:
    image: 2j-platform:staging
    container_name: 2j-platform-member-api
    restart: unless-stopped
    network_mode: host
    working_dir: /repo
    command: ["node", "apps/api/dist/server.js"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ${ROOT}/secrets/platform-db.env
    environment:
      NODE_ENV: development
      HOST: 127.0.0.1
      PORT: "${PLATFORM_MEMBER_PORT}"
      PILOT_MEMBER_AUTH_ENABLED: "true"
      PILOT_MEMBER_BOOKING_ENABLED: "true"
      MEMBER_APP_ORIGIN: http://127.0.0.1:5173
      CORS_ORIGIN: http://127.0.0.1:5173
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:${PLATFORM_MEMBER_PORT}/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
EOF
  # Not set on purpose: TRAINING_* / SSO / signals / PUSH_* / VAPID / PLATFORM_INTERNAL_SERVICE_KEYS. Fiscal gate and contract terms stay closed in the code.

  cat > "$dir/bunker.env" <<EOF
# STAGING Búnker. No production value in this file. Integration flags stay at their closed defaults.
RP_ID=${HOSTS_APP}
ORIGIN=https://${HOSTS_APP}
WEB_PORT=127.0.0.1:${BUNKER_LOCAL_PORT}
RP_NAME=2J Fitness Center (STAGING)
INVITE_ONLY=1
COACH_DISABLED=1
PLATFORM_PROOF_ISSUANCE_ENABLED=false
PLATFORM_PROOF_EXCHANGE_ENABLED=false
PLATFORM_PROOF_RECONCILIATION_ENABLED=false
EOF
}

cmd_render() {
  local dir="${1:-}"; [ -n "$dir" ] || die "Uso: 2j-staging render DIR"
  FAKE_BASIC_HASH='$2a$14$FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK' render_files "$dir"
  say "Archivos de ejemplo escritos en $dir (con secretos falsos)."
}

# ----------------------------------------------------------------------------------------------------------------------------------------------------
cmd_deploy() {
  need_root; log_start
  [ "$ACCEPT_ADMIN_WITHOUT_STAFF_AUTH" = "yes" ] || die "Lee la sección «Lo que debes saber» del runbook y pon ACCEPT_ADMIN_WITHOUT_STAFF_AUTH=\"yes\" en $CONF."
  validate_conf
  command -v docker >/dev/null && command -v caddy >/dev/null || die "Falta la base: ejecuta '2j-staging base' primero."

  say "0/8 DNS (si no apunta aquí, Let's Encrypt fallaría y limita los reintentos)"
  for h in "$HOSTS_HOME" "$HOSTS_APP" "$HOSTS_ADMIN"; do
    ips="$( { getent ahostsv4 "$h" || true; } | awk '{print $1}' | sort -u | tr '\n' ' ')"
    case " $ips " in *" $SERVER_IP "*) ok "$h -> $ips";; *) die "$h apunta a '${ips:-nada}' y debería ser $SERVER_IP. Corrige el DNS y espera a que propague.";; esac
  done

  say "1/8 Secretos (se generan aquí, solo si no existen; no se imprimen)"
  secret_file "$ROOT/secrets/postgres.pass"; secret_file "$ROOT/secrets/platform-db.pass"; secret_file "$ROOT/secrets/basic-auth.pass"
  printf 'POSTGRES_PASSWORD=%s\n' "$(cat "$ROOT/secrets/postgres.pass")" > "$ROOT/secrets/postgres.env"
  printf 'DATABASE_URL=postgres://platform_app:%s@127.0.0.1:5432/2j_demo\n' "$(cat "$ROOT/secrets/platform-db.pass")" > "$ROOT/secrets/platform-db.env"
  chmod 600 "$ROOT"/secrets/*

  say "2/8 Código (solo lectura)"
  git_sync platform "$PLATFORM_REPO" "$PLATFORM_REF" "$ROOT/src/platform"
  git_sync bunker   "$BUNKER_REPO"   "$BUNKER_REF"   "$ROOT/src/bunker"
  git -C "$ROOT/src/platform" rev-parse HEAD > "$ROOT/last-platform-commit"; git -C "$ROOT/src/bunker" rev-parse HEAD > "$ROOT/last-bunker-commit"

  say "3/8 Archivos de configuración"
  render_files "$ROOT/build/generated"
  cp "$ROOT/build/generated/Dockerfile.platform" "$ROOT/build/Dockerfile.platform"
  cp "$ROOT/build/generated/Dockerfile.platform.dockerignore" "$ROOT/build/Dockerfile.platform.dockerignore"
  cp "$ROOT/build/generated/platform.compose.yml" "$ROOT/compose/platform.compose.yml"
  cp "$ROOT/build/generated/bunker.env" "$ROOT/src/bunker/.env"; chmod 600 "$ROOT/src/bunker/.env"

  say "4/8 Construyendo Platform (API + Admin + Home); tarda varios minutos"
  docker build -f "$ROOT/build/Dockerfile.platform" -t 2j-platform:staging \
    --build-arg "ADMIN_ORIGIN=https://${HOSTS_ADMIN}" --build-arg "HOME_ORIGIN=https://${HOSTS_HOME}" --build-arg "BUNKER_ORIGIN=https://${HOSTS_APP}" \
    "$ROOT/src/platform"
  for pair in "admin:apps/admin-web/dist" "home:apps/client-app/dist"; do
    name="${pair%%:*}"; path="${pair#*:}"; cid="$(docker create 2j-platform:staging)"
    rm -rf "${ROOT:?}/www/${name}.new"; docker cp "${cid}:/repo/${path}" "$ROOT/www/${name}.new"; docker rm "$cid" >/dev/null
    rm -rf "${ROOT:?}/www/${name}"; mv "$ROOT/www/${name}.new" "$ROOT/www/${name}"; chmod -R a+rX "$ROOT/www/${name}"
  done
  chmod a+rx "$ROOT" "$ROOT/www"

  say "5/8 Base de datos de Platform (aislada, sin puerto público)"
  docker compose -f "$ROOT/compose/platform.compose.yml" up -d postgres
  for _ in $(seq 1 60); do docker exec 2j-postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
  docker exec 2j-postgres pg_isready -U postgres >/dev/null 2>&1 || die "PostgreSQL no arrancó (mira: docker logs 2j-postgres)."
  appw="$(cat "$ROOT/secrets/platform-db.pass")"
  printf "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='platform_app') THEN CREATE ROLE platform_app LOGIN PASSWORD '%s'; ELSE ALTER ROLE platform_app PASSWORD '%s'; END IF; END \$\$;\n" "$appw" "$appw" \
    | docker exec -i 2j-postgres psql -U postgres -v ON_ERROR_STOP=1 -q >/dev/null
  docker exec 2j-postgres psql -U postgres -Atc "SELECT 1 FROM pg_database WHERE datname='2j_demo'" | grep -q 1 \
    || docker exec 2j-postgres psql -U postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"2j_demo\" OWNER platform_app"
  unset appw
  say "   migraciones de la base de STAGING (nueva y vacía)"
  docker run --rm --network host --env-file "$ROOT/secrets/platform-db.env" -e NODE_ENV=development -w /repo/apps/api 2j-platform:staging node --import tsx src/migrate.ts

  say "6/8 Arrancando Platform y Búnker"
  docker compose -f "$ROOT/compose/platform.compose.yml" up -d
  ( cd "$ROOT/src/bunker" && docker compose up -d --build )

  say "7/8 HTTPS (Caddy)"
  [ -f "$ROOT/secrets/basic-auth.txt" ] || printf 'usuario: staging\ncontraseña: %s\n' "$(cat "$ROOT/secrets/basic-auth.pass")" > "$ROOT/secrets/basic-auth.txt"
  chmod 600 "$ROOT/secrets/basic-auth.txt"
  caddy validate --config "$ROOT/build/generated/Caddyfile" --adapter caddyfile >/dev/null || die "El Caddyfile generado no es válido (NO se ha instalado ni recargado nada)."
  cp "$ROOT/build/generated/Caddyfile" /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy

  say "8/8 Copia de seguridad diaria"
  install_backup_timer

  cat <<EOF

Despliegue terminado. Siguiente:
  2j-staging seed        (datos de prueba)
  2j-staging selftest    (OK/FAIL por subdominio)
La contraseña de acceso a las tres webs está guardada en ${ROOT}/secrets/basic-auth.txt (solo root). No se muestra aquí.
EOF
}

install_backup_timer() {
  cat > /usr/local/sbin/2j-staging-backup <<EOF
#!/usr/bin/env bash
# Daily local backup of the STAGING databases/data. Same disk: it protects against mistakes, NOT against losing the server.
set -Eeuo pipefail; umask 077
stamp=\$(date +%F-%H%M)
tmp=${ROOT}/backups/.platform-\${stamp}.tmp
docker exec 2j-postgres pg_dump -U postgres -Fc 2j_demo > "\$tmp"
docker exec -i 2j-postgres pg_restore -l < "\$tmp" >/dev/null   # a dump that cannot be listed is not kept
mv "\$tmp" ${ROOT}/backups/platform-\${stamp}.dump
tar czf ${ROOT}/backups/bunker-data-\${stamp}.tgz -C ${ROOT}/src/bunker data 2>/dev/null || echo "AVISO: copia de datos de Bunker no creada" >&2
find ${ROOT}/backups -type f \( -name 'platform-*.dump' -o -name 'bunker-data-*.tgz' \) -mtime +${BACKUP_KEEP_DAYS} -delete
EOF
  chmod 700 /usr/local/sbin/2j-staging-backup
  cat > /etc/systemd/system/2j-staging-backup.service <<'EOF'
[Unit]
Description=2J staging backup
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/2j-staging-backup
EOF
  cat > /etc/systemd/system/2j-staging-backup.timer <<'EOF'
[Unit]
Description=2J staging daily backup
[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload; systemctl enable --now 2j-staging-backup.timer
}

cmd_backup() { need_root; [ -x /usr/local/sbin/2j-staging-backup ] || die "Aún no hay despliegue."; /usr/local/sbin/2j-staging-backup; ls -l "$ROOT/backups" | tail -5; }

cmd_restore_db() {
  need_root; f="${1:-}"; [ -f "$f" ] || die "Uso: 2j-staging restore-db /opt/2j/backups/platform-AAAA-MM-DD-HHMM.dump"
  docker exec -i 2j-postgres pg_restore -l < "$f" >/dev/null || die "Ese fichero no es una copia válida (no se ha tocado nada)."
  printf "Esto REEMPLAZA la base actual por %s. Se guarda antes una copia de seguridad. Escribe RESTAURAR para continuar:\n> " "$f"; read -r phrase; [ "$phrase" = "RESTAURAR" ] || die "Cancelado: no se ha tocado nada."
  docker exec 2j-postgres pg_dump -U postgres -Fc 2j_demo > "$ROOT/backups/pre-restore-$(date +%F-%H%M).dump"
  say "Parando las APIs, restaurando y volviendo a arrancar"
  docker compose -f "$ROOT/compose/platform.compose.yml" stop platform-admin-api platform-member-api
  docker exec 2j-postgres psql -U postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"2j_demo\" WITH (FORCE)" -c "CREATE DATABASE \"2j_demo\" OWNER platform_app"
  docker exec -i 2j-postgres pg_restore -U postgres -d 2j_demo --no-owner --role=platform_app < "$f"
  docker compose -f "$ROOT/compose/platform.compose.yml" start platform-admin-api platform-member-api
  ok "Restaurado desde $f"
}

cmd_seed() {
  need_root
  say "Datos de prueba SINTÉTICOS (personas @example.test) en la base de STAGING"
  docker run --rm --network host --env-file "$ROOT/secrets/platform-db.env" -e NODE_ENV=development -w /repo/apps/api 2j-platform:staging node --import tsx scripts/seed-demo.ts
  ok "Hecho. (Códigos de acceso de miembro de prueba: ver runbook, sección «Datos de prueba».)"
}

# ----------------------------------------------------------------------------------------------------------------------------------------------------
cmd_selftest() {
  need_root; FAILS=0
  local user pass; user=staging; pass="$(cat "$ROOT/secrets/basic-auth.pass" 2>/dev/null || true)"
  [ -n "$pass" ] || die "Aún no hay despliegue (falta ${ROOT}/secrets/basic-auth.pass)."
  say "DNS (cada nombre debe apuntar a ${SERVER_IP})"
  for h in "$HOSTS_HOME" "$HOSTS_APP" "$HOSTS_ADMIN"; do
    ips="$( { getent ahostsv4 "$h" || true; } | awk '{print $1}' | sort -u | tr '\n' ' ')"
    case " $ips " in *" $SERVER_IP "*) ok "$h -> $ips";; *) bad "$h apunta a '${ips:-nada}' (debería ser $SERVER_IP)";; esac
  done
  say "HTTPS y salud (certificado real, sin saltarse la comprobación)"
  for h in "$HOSTS_HOME" "$HOSTS_APP"; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$h/" 2>/dev/null || true)"; [ "$code" = 401 ] && ok "$h sin contraseña -> 401 (protegida)" || bad "$h sin contraseña -> ${code:-sin respuesta} (esperado 401)"
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -K <(printf 'user = "%s:%s"\n' "$user" "$pass") "https://$h/" 2>/dev/null || true)"; [ "$code" = 200 ] && ok "$h con contraseña -> 200" || bad "$h con contraseña -> ${code:-sin respuesta} (esperado 200)"
    body="$(curl -sS --max-time 20 -K <(printf 'user = "%s:%s"\n' "$user" "$pass") "https://$h/healthz" 2>/dev/null || true)"; case "$body" in *'"ok"'*) ok "$h /healthz -> ok";; *) bad "$h /healthz -> ${body:0:80}";; esac
  done
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --resolve "${HOSTS_ADMIN}:443:127.0.0.1" -K <(printf 'user = "%s:%s"\n' "$user" "$pass") "https://${HOSTS_ADMIN}/healthz" 2>/dev/null || true)"
  [ "$code" = 200 ] && ok "$HOSTS_ADMIN (desde el propio servidor) /healthz -> 200" || bad "$HOSTS_ADMIN /healthz -> ${code:-sin respuesta} (esperado 200)"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://${HOSTS_ADMIN}/" 2>/dev/null || true)"
  if [ -z "$ADMIN_ALLOW_IPS" ]; then [ "$code" = 403 ] && ok "$HOSTS_ADMIN cerrado al exterior (403): ADMIN_ALLOW_IPS vacío" || bad "$HOSTS_ADMIN desde fuera -> ${code:-sin respuesta} (esperado 403)"
  else [ "$code" = 403 ] && warn "$HOSTS_ADMIN desde este servidor da 403 (normal: tu IP no es esta). Pruébalo desde tu ordenador." || warn "$HOSTS_ADMIN -> ${code}"; fi
  say "Contenedores"
  for c in 2j-postgres 2j-platform-admin-api 2j-platform-member-api; do
    st="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" 2>/dev/null || echo missing)"; case "$st" in running/healthy) ok "$c $st";; *) bad "$c $st";; esac
  done
  for c in $(cd "$ROOT/src/bunker" && docker compose ps -q 2>/dev/null); do n="$(docker inspect -f '{{.Name}} {{.State.Status}}' "$c")"; case "$n" in *exited*) warn "$n (normal para el servicio 'media' si terminó)";; *running*) ok "$n";; *) bad "$n";; esac; done
  say "Seguridad"
  ufw status | grep -q "Status: active" && ok "UFW activo" || bad "UFW no está activo"
  pub="$(ss -ltnH | awk '{print $4}' | grep -Ev '^(127\.|\[::1\]|::1)' | sed 's/.*://' | sort -un | tr '\n' ' ')"
  rest="$(for p in $pub; do case "$p" in 22|80|443) ;; *) printf '%s ' "$p";; esac; done)"; [ -z "$rest" ] && ok "Solo escuchan hacia fuera los puertos: ${pub}" || bad "Puertos públicos inesperados: $rest"
  systemctl is-active --quiet fail2ban && ok "fail2ban activo" || bad "fail2ban no está activo"
  systemctl is-enabled --quiet 2j-staging-backup.timer && ok "copia diaria programada" || bad "falta la copia diaria"
  [ -s /etc/ssh/sshd_config.d/00-2j-hardening.conf ] && ok "SSH endurecido (solo clave)" || warn "SSH aún NO endurecido: ejecuta '2j-staging lock-ssh --confirm' tras probar el login nuevo"
  [ "$(stat -c %a "$ROOT/secrets")" = 700 ] && ok "carpeta de secretos 700" || bad "permisos de $ROOT/secrets"
  if [ "$FAILS" -eq 0 ]; then printf '\nRESULTADO: TODO OK\n'; else printf '\nRESULTADO: %s FALLO(S)\n' "$FAILS"; exit 1; fi
}

cmd_status() {
  need_root
  docker ps --format 'table {{.Names}}\t{{.Status}}'; echo
  printf 'Platform: %s\nBúnker:   %s\n' "$(cat "$ROOT/last-platform-commit" 2>/dev/null || echo -)" "$(cat "$ROOT/last-bunker-commit" 2>/dev/null || echo -)"
  systemctl is-active caddy fail2ban 2>/dev/null || true
  ls -l "$ROOT/backups" 2>/dev/null | tail -4
}

cmd_teardown() {
  need_root
  [ "$ROOT" = "/opt/2j" ] || die "teardown solo funciona sobre /opt/2j (valor actual: $ROOT). Nada borrado."
  [ -f "$ROOT/last-platform-commit" ] || [ -d "$ROOT/secrets" ] || die "$ROOT no parece un staging de 2J. Nada borrado."
  [ "${1:-}" = "--yes" ] || die "Escribe: 2j-staging teardown --yes   (destruye el staging; no toca el sistema operativo ni el acceso SSH)."
  printf 'Esto BORRA TODO el contenido de %s (bases de datos, secretos y copias de STAGING). Para continuar escribe exactamente:  DESTRUIR STAGING\n> ' "$ROOT"; read -r phrase
  [ "$phrase" = "DESTRUIR STAGING" ] || die "Cancelado: no se ha borrado nada."
  ( cd "$ROOT/src/bunker" 2>/dev/null && docker compose down -v --remove-orphans ) || true
  docker compose -f "$ROOT/compose/platform.compose.yml" down -v --remove-orphans 2>/dev/null || true
  docker rm -f 2j-postgres 2j-platform-admin-api 2j-platform-member-api >/dev/null 2>&1 || true
  docker image rm 2j-platform:staging >/dev/null 2>&1 || true
  systemctl disable --now 2j-staging-backup.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/2j-staging-backup.* /usr/local/sbin/2j-staging-backup; systemctl daemon-reload
  printf ':80 {\n\trespond "staging apagado" 200\n}\n' > /etc/caddy/Caddyfile; systemctl restart caddy || true
  rm -rf "${ROOT:?}"
  ok "Staging destruido. Quedan: usuario ${OPS_USER}, cortafuegos, fail2ban, Docker y Caddy (para volver a empezar: 2j-staging base && 2j-staging deploykeys && 2j-staging deploy)."
}

# ----------------------------------------------------------------------------------------------------------------------------------------------------
validate_conf() {
  local ip n
  for ip in $ADMIN_ALLOW_IPS; do
    case "$ip" in
      */*) n="${ip#*/}"; ip="${ip%/*}";;
      *) n="";;
    esac
    if [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
      for o in "${BASH_REMATCH[@]:1}"; do [ "$o" -le 255 ] || die "ADMIN_ALLOW_IPS: IP no válida: $ip"; done
      [ -z "$n" ] || { [[ "$n" =~ ^[0-9]{1,2}$ ]] && [ "$n" -ge 24 ] && [ "$n" -le 32 ]; } || die "ADMIN_ALLOW_IPS: máscara /$n demasiado ancha (mínimo /24): $ip/$n"
    elif [[ "$ip" =~ ^[0-9a-fA-F:]+$ ]] && [[ "$ip" == *:* ]]; then
      [ -z "$n" ] || { [[ "$n" =~ ^[0-9]{1,3}$ ]] && [ "$n" -ge 64 ] && [ "$n" -le 128 ]; } || die "ADMIN_ALLOW_IPS: prefijo IPv6 /$n demasiado ancho (mínimo /64)"
    else
      die "ADMIN_ALLOW_IPS: valor no válido: '$ip' (usa IPs como 83.57.105.60 o 83.57.105.0/24; nunca 0.0.0.0/0)"
    fi
  done
}

main() {
  local cmd="${1:-help}"; shift || true
  case "$cmd" in
    init) cmd_init;; base) cmd_base;; lock-ssh) cmd_lock_ssh "$@";; deploykeys) cmd_deploykeys;; deploy) cmd_deploy;; seed) cmd_seed;;
    selftest) cmd_selftest;; status) cmd_status;; backup) cmd_backup;; restore-db) cmd_restore_db "$@";; teardown) cmd_teardown "$@";; render) cmd_render "$@";;
    *) sed -n '2,25p' "$0";;
  esac
}
main "$@"
