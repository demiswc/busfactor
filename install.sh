#!/usr/bin/env bash
# busfactor installer for Ubuntu 22.04+ / Debian 12+.
#
#   Fresh install:          sudo bash install.sh
#   Update later:           sudo bash install.sh --update
#   With Docker instead:    sudo bash install.sh --docker        (update: --docker --update)
#
# Everything can be preset with environment variables for unattended installs, e.g.
#   sudo DOMAIN=busfactor.example.com SMTP_HOST=mail.example.com SMTP_USER=... SMTP_PASS=... ./install.sh --yes
#
# What it does: installs Node.js 22 (if needed) and MariaDB (unless you give DATABASE_URL),
# creates a 'busfactor' system user, database and .env with fresh secrets, builds the app,
# and sets up two systemd units: the web app and a 5-minute scheduler timer.
# Optionally installs Caddy for automatic HTTPS.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/demiswc/busfactor.git}"
APP_DIR="${APP_DIR:-/opt/busfactor}"
APP_USER="${APP_USER:-busfactor}"
PORT="${PORT:-3000}"
ASSUME_YES=0
MODE=install
NO_SYSTEMD="${NO_SYSTEMD:-0}"
USE_DOCKER=0

for arg in "$@"; do
  case "$arg" in
    --update) MODE=update ;;
    --docker) USE_DOCKER=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  \033[36m•\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# Questions read from the terminal even when the script is piped in (curl ... | sudo bash).
interactive() { [ "$ASSUME_YES" != 1 ] && { : </dev/tty; } 2>/dev/null; }
ask() { # ask VAR "Question" "default"
  local var="$1" q="$2" def="${3:-}" val=""
  if [ -n "${!var:-}" ]; then return; fi
  if interactive; then read -r -p "  $q${def:+ [$def]}: " val </dev/tty; fi
  printf -v "$var" '%s' "${val:-$def}"
}
ask_secret() {
  local var="$1" q="$2" val=""
  if [ -n "${!var:-}" ]; then return; fi
  if interactive; then read -r -s -p "  $q: " val </dev/tty; echo; fi
  printf -v "$var" '%s' "$val"
}
as_app() { sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && $*"; }
write_tick_header() {
  local secret
  secret=$(grep '^CRON_SECRET=' "$APP_DIR/.env" | cut -d= -f2-)
  ( umask 077; printf 'x-cron-secret: %s\n' "$secret" > "$APP_DIR/.tick-header" )
  chown "$APP_USER:$APP_USER" "$APP_DIR/.tick-header"
}
tune_mariadb() {
  # Personal messages with attachments can be ~20 MB once encrypted; the default 16 MB packet is too small.
  if [ -d /etc/mysql/mariadb.conf.d ] && [ ! -f /etc/mysql/mariadb.conf.d/99-busfactor.cnf ]; then
    printf '[mysqld]\nmax_allowed_packet=64M\n' > /etc/mysql/mariadb.conf.d/99-busfactor.cnf
    [ "$NO_SYSTEMD" = 1 ] || systemctl restart mariadb || true
  fi
}

[ "$(id -u)" = 0 ] || die "Please run as root (sudo bash install.sh)."

# ------------------------------------------------------------------ docker mode
if [ "$USE_DOCKER" = 1 ]; then
  SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ ! -f "$SRC_DIR/docker-compose.yml" ]; then
    command -v git >/dev/null || die "Please install git first."
    [ -d "$APP_DIR/.git" ] || git clone --depth 1 "$REPO_URL" "$APP_DIR"
    SRC_DIR="$APP_DIR"
  fi
  cd "$SRC_DIR"
  if ! docker compose version >/dev/null 2>&1; then
    bold "Docker is not installed"
    ask INSTALL_DOCKER "Install Docker now using the official script from get.docker.com? (y/n)" "y"
    [ "$INSTALL_DOCKER" = y ] || die "Install Docker (https://docs.docker.com/engine/install/) and run this again."
    curl -fsSL https://get.docker.com | sh
  fi
  if [ "$MODE" = update ]; then
    bold "Updating busfactor (Docker)"
    [ -d .git ] && git pull --ff-only
    PROFILE=""; grep -q '^USE_CADDY=y' .env 2>/dev/null && PROFILE="--profile https"
    # shellcheck disable=SC2086
    docker compose $PROFILE up -d --build
    bold "Updated."; exit 0
  fi
  bold "busfactor installer (Docker)"
  ask DOMAIN "Domain name for the site (e.g. busfactor.example.com)" "localhost"
  ask USE_CADDY "Add Caddy for automatic HTTPS on ports 80/443? (y/n). Say n if you already run a web server" "y"
  echo "  Outgoing email is required: reminders and alerts are sent by SMTP."
  ask SMTP_HOST "SMTP host" ""
  ask SMTP_PORT "SMTP port (465 or 587)" "465"
  ask SMTP_USER "SMTP username" ""
  ask_secret SMTP_PASS "SMTP password (hidden)"
  ask SMTP_FROM "From address" "busfactor <no-reply@${DOMAIN}>"
  ask OPERATOR_EMAIL "Contact email shown on the privacy page" "${SMTP_USER:-}"
  ask OPERATOR_ADMIN_EMAILS "Your busfactor account email, to see usage stats at /stats (blank to skip)" ""
  if [ -f .env ]; then
    warn "Keeping existing $(pwd)/.env (secrets unchanged)"
  else
    umask 077
    cat > .env <<ENV
DOMAIN=${DOMAIN}
USE_CADDY=${USE_CADDY}
APP_URL=https://${DOMAIN}
DB_PASSWORD=$(openssl rand -hex 18)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 24)
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS_B64=$(printf '%s' "$SMTP_PASS" | base64 -w0)
SMTP_FROM="${SMTP_FROM//\"/\\\"}"
DEFAULT_TIMEZONE=${DEFAULT_TIMEZONE:-Europe/London}
OPERATOR_NAME=${OPERATOR_NAME:-}
OPERATOR_EMAIL=${OPERATOR_EMAIL:-}
OPERATOR_ADMIN_EMAILS=${OPERATOR_ADMIN_EMAILS:-}
ALLOW_SERVER_INSTRUCTIONS=${ALLOW_SERVER_INSTRUCTIONS:-true}
PORT=${PORT}
ENV
    umask 022
  fi
  bold "Building and starting containers (a few minutes the first time)"
  PROFILE=""; [ "$USE_CADDY" = y ] && PROFILE="--profile https"
  # shellcheck disable=SC2086
  docker compose $PROFILE up -d --build
  echo
  bold "busfactor is running in Docker."
  echo "  Site:     https://${DOMAIN}$( [ "$USE_CADDY" = y ] || echo "  (proxy your web server to 127.0.0.1:${PORT})")"
  echo "  Logs:     docker compose logs -f app"
  echo "  Update:   sudo bash install.sh --docker --update"
  warn "Back up $(pwd)/.env and the 'db' volume. APP_ENCRYPTION_KEY is needed to read your users' details."
  exit 0
fi

command -v apt-get >/dev/null || die "This installer supports Debian/Ubuntu (or any Linux with --docker). See README for manual steps."

# ------------------------------------------------------------------ update
if [ "$MODE" = update ]; then
  [ -f "$APP_DIR/.env" ] || die "No existing install found at $APP_DIR."
  bold "Updating busfactor in $APP_DIR"
  if [ -d "$APP_DIR/.git" ]; then as_app "git pull --ff-only"; fi
  as_app "npm ci --no-audit --no-fund"
  as_app "npx prisma db push"  # prisma.config.ts reads .env itself
  as_app "npm run build"
  write_tick_header
  [ "$NO_SYSTEMD" = 1 ] || systemctl restart busfactor
  bold "Updated."
  exit 0
fi

# ------------------------------------------------------------------ questions
bold "busfactor installer"
echo "  Press Enter to accept the [default]."
ask DOMAIN "Domain name for the site (e.g. busfactor.example.com)" "$(hostname -f 2>/dev/null || echo localhost)"
ask USE_CADDY "Install Caddy for automatic HTTPS? (y/n). Say n if you already run nginx/Apache/Plesk" "n"
if [ -z "${DATABASE_URL:-}" ]; then
  ask INSTALL_DB "Install MariaDB on this server? (y/n). Say n to enter your own DATABASE_URL" "y"
  if [ "$INSTALL_DB" != y ]; then ask DATABASE_URL "DATABASE_URL (mysql://user:pass@host:3306/db)" ""; fi
fi
echo
echo "  Outgoing email is required: reminders and alerts are sent by SMTP."
ask SMTP_HOST "SMTP host" ""
ask SMTP_PORT "SMTP port (465 or 587)" "465"
ask SMTP_USER "SMTP username" ""
ask_secret SMTP_PASS "SMTP password (hidden)"
ask SMTP_FROM "From address" "busfactor <no-reply@${DOMAIN}>"
ask OPERATOR_EMAIL "Contact email shown on the privacy page" "${SMTP_USER:-}"
ask OPERATOR_ADMIN_EMAILS "Your busfactor account email, to see usage stats at /stats (blank to skip)" ""
[ -n "$SMTP_HOST" ] || warn "No SMTP host given: the site will not be able to send email until you set SMTP_* in $APP_DIR/.env"

# ------------------------------------------------------------------ packages
bold "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git openssl rsync sudo >/dev/null

NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  info "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
info "Node $(node -v)"

if [ -z "${DATABASE_URL:-}" ]; then
  if ! command -v mariadb >/dev/null && ! command -v mysql >/dev/null; then
    info "Installing MariaDB"
    apt-get install -y -qq mariadb-server >/dev/null
  fi
  [ "$NO_SYSTEMD" = 1 ] || systemctl enable --now mariadb >/dev/null 2>&1 || true
  tune_mariadb
fi

# ------------------------------------------------------------------ user & code
bold "Setting up $APP_DIR"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/var/lib/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SRC_DIR/package.json" ] && grep -q '"name": "busfactor"' "$SRC_DIR/package.json"; then
  if [ "$SRC_DIR" != "$APP_DIR" ]; then
    info "Copying from $SRC_DIR"
    mkdir -p "$APP_DIR"
    rsync -a --delete --exclude node_modules --exclude .next --exclude .env --exclude .tick-header "$SRC_DIR/" "$APP_DIR/"
  fi
elif [ ! -d "$APP_DIR/.git" ]; then
  info "Cloning $REPO_URL"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ------------------------------------------------------------------ database
if [ -z "${DATABASE_URL:-}" ]; then
  DB_PASS=$(openssl rand -hex 18)
  info "Creating database 'busfactor'"
  mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS busfactor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'busfactor'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER 'busfactor'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON busfactor.* TO 'busfactor'@'localhost';
FLUSH PRIVILEGES;
SQL
  DATABASE_URL="mysql://busfactor:${DB_PASS}@127.0.0.1:3306/busfactor"
fi

# ------------------------------------------------------------------ .env
if [ -f "$APP_DIR/.env" ]; then
  warn "Keeping existing $APP_DIR/.env (secrets unchanged)"
else
  info "Writing $APP_DIR/.env with fresh secrets"
  umask 077
  cat > "$APP_DIR/.env" <<ENV
APP_URL=https://${DOMAIN}
DATABASE_URL=${DATABASE_URL}
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 24)
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS_B64=$(printf '%s' "$SMTP_PASS" | base64 -w0)
SMTP_FROM="${SMTP_FROM//\"/\\\"}"
DEFAULT_TIMEZONE=${DEFAULT_TIMEZONE:-Europe/London}
OPERATOR_NAME=${OPERATOR_NAME:-}
OPERATOR_EMAIL=${OPERATOR_EMAIL:-}
OPERATOR_ADMIN_EMAILS=${OPERATOR_ADMIN_EMAILS:-}
ALLOW_SERVER_INSTRUCTIONS=${ALLOW_SERVER_INSTRUCTIONS:-true}
PORT=${PORT}
NODE_ENV=production
ENV
  umask 022
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

# ------------------------------------------------------------------ build
bold "Building (this takes a few minutes)"
as_app "npm ci --no-audit --no-fund"
as_app "npx prisma db push"  # prisma.config.ts reads .env itself
as_app "NODE_ENV=production npm run build"

# ------------------------------------------------------------------ services
if [ "$NO_SYSTEMD" != 1 ]; then
  bold "Creating services"
  write_tick_header
  NPX_BIN="$(command -v npx)"
  cat > /etc/systemd/system/busfactor.service <<UNIT
[Unit]
Description=busfactor web app
After=network.target mariadb.service

[Service]
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${NPX_BIN} next start -H 127.0.0.1 -p ${PORT}
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
  cat > /etc/systemd/system/busfactor-tick.service <<UNIT
[Unit]
Description=busfactor scheduler tick
After=busfactor.service

[Service]
Type=oneshot
User=${APP_USER}
EnvironmentFile=${APP_DIR}/.env
# The secret is read from a file (-H @file), so it never appears in the process list.
ExecStart=/usr/bin/curl -fsS -m 120 -X POST -H @${APP_DIR}/.tick-header http://127.0.0.1:${PORT}/api/cron/tick
UNIT
  cat > /etc/systemd/system/busfactor-tick.timer <<UNIT
[Unit]
Description=Run the busfactor scheduler every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now busfactor.service busfactor-tick.timer >/dev/null
  info "busfactor.service and busfactor-tick.timer are running"
fi

# ------------------------------------------------------------------ HTTPS
if [ "${USE_CADDY:-n}" = y ]; then
  bold "Installing Caddy (automatic HTTPS)"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
  encode gzip
  request_body {
    max_size 32MB
  }
  reverse_proxy 127.0.0.1:${PORT}
}
CADDY
  systemctl reload caddy || systemctl restart caddy
  info "Caddy will fetch a certificate for ${DOMAIN} (DNS must already point here)"
fi

# ------------------------------------------------------------------ done
echo
bold "busfactor is installed."
echo "  App:        http://127.0.0.1:${PORT} (behind your web server)"
echo "  Site:       https://${DOMAIN}"
echo "  Config:     ${APP_DIR}/.env"
echo "  Logs:       journalctl -u busfactor -f"
echo "  Update:     sudo ${APP_DIR}/install.sh --update"
if [ "${USE_CADDY:-n}" != y ]; then
  echo
  echo "  Point your web server at 127.0.0.1:${PORT}. nginx example:"
  echo "    client_max_body_size 32m;"
  echo "    location / { proxy_pass http://127.0.0.1:${PORT}; proxy_set_header Host \$host;"
  echo "                 proxy_set_header X-Forwarded-For \$remote_addr; proxy_set_header X-Forwarded-Proto https; }"
fi
echo
warn "Back up ${APP_DIR}/.env somewhere safe. Without APP_ENCRYPTION_KEY, users' names, emails and contacts cannot be read."
