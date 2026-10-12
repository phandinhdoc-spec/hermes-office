#!/usr/bin/env bash
# Hermes Office setup / sideload / daemon CLI (macOS; service commands also Linux + Windows Git Bash).
#
#   ./install.sh [install]   certs + deps + manifest sideload + install and start the background service
#   ./install.sh certs       (re)generate and trust the localhost dev certificate
#   ./install.sh sideload    copy manifest.xml into the Word/Excel/PowerPoint wef folders (macOS)
#   ./install.sh uninstall   remove the service and the sideloaded manifests (keeps certs)
#   ./install.sh status      show what is installed
#   ./install.sh start       run bridge + Vite dev server together (development)
#
#   ./install.sh service-install     install + start the autostart daemon
#                                    (one server on https://localhost:8765: bridge AND add-in)
#   ./install.sh service-uninstall   stop and remove the daemon
#   ./install.sh service-status | service-start | service-stop | service-restart
#
# Service: macOS LaunchAgent (com.hermes.office), Linux systemd --user unit, Windows scheduled task.
# Flags: --no-trust    skip adding the cert to the trust store
#        --no-service  with install: do not install the background service
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$ROOT/manifest.xml"
MANIFEST_NAME="hermes-office.manifest.xml"
CERT_DIR="$HOME/.hermes-office/certs"
APPS=(Word Excel Powerpoint)   # container suffix: com.microsoft.<App>
TRUST=1
SERVICE=1
PORT=8765
LABEL="com.hermes.office"
TASK_NAME="HermesOffice"
LOG_DIR="$HOME/.hermes-office"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT="$HOME/.config/systemd/user/hermes-office.service"

for a in "$@"; do
  [ "$a" = "--no-trust" ] && TRUST=0
  [ "$a" = "--no-service" ] && SERVICE=0
done
CMD="${1:-install}"; [[ "$CMD" == --* ]] && CMD=install

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=mac ;;
  Linux) OS=linux ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows ;;
  *) die "unsupported OS: $(uname -s)" ;;
esac

if [ "$OS" = windows ]; then
  VENV_PY="$ROOT/bridge/.venv/Scripts/python.exe"
  VENV_PYW="$ROOT/bridge/.venv/Scripts/pythonw.exe"   # no console window
  VENV_PIP="$ROOT/bridge/.venv/Scripts/pip.exe"
else
  VENV_PY="$ROOT/bridge/.venv/bin/python"
  VENV_PYW="$VENV_PY"
  VENV_PIP="$ROOT/bridge/.venv/bin/pip"
fi

wef_dir() { echo "$HOME/Library/Containers/com.microsoft.$1/Data/Documents/wef"; }

do_certs() {
  command -v openssl >/dev/null || die "openssl not found"
  mkdir -p "$CERT_DIR"
  if [ -f "$CERT_DIR/localhost.crt" ] && openssl x509 -checkend 2592000 -noout -in "$CERT_DIR/localhost.crt" >/dev/null 2>&1; then
    say "Dev cert already valid: $CERT_DIR/localhost.crt"
  else
    say "Generating self-signed cert for localhost / 127.0.0.1"
    openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
      -keyout "$CERT_DIR/localhost.key" -out "$CERT_DIR/localhost.crt" \
      -subj "/CN=localhost/O=Hermes Office Dev" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
      -addext "basicConstraints=critical,CA:TRUE" \
      -addext "keyUsage=critical,digitalSignature,keyCertSign" \
      -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1
    chmod 600 "$CERT_DIR/localhost.key"
  fi
  if [ "$TRUST" = 1 ]; then
    case "$OS" in
      mac)
        say "Trusting cert in login keychain (may prompt for your password)"
        security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" \
          "$CERT_DIR/localhost.crt" || warn "Could not trust cert automatically; trust it manually in Keychain Access." ;;
      windows)
        say "Trusting cert in the current user's Root store (Windows may show a confirmation dialog)"
        certutil -user -addstore Root "$(cygpath -w "$CERT_DIR/localhost.crt")" >/dev/null \
          || warn "Could not trust cert automatically; import $CERT_DIR/localhost.crt into Trusted Root Certification Authorities." ;;
      *) warn "Trust $CERT_DIR/localhost.crt manually in your system CA store / browser." ;;
    esac
  else
    warn "Skipping trust step; Office will reject the https taskpane until the cert is trusted."
  fi
}

do_sideload() {
  if [ "$OS" != mac ]; then
    warn "Automatic sideloading is macOS-only. Add $MANIFEST via a shared-folder add-in catalog (Windows) or Office's add-in upload."
    return 0
  fi
  [ -f "$MANIFEST" ] || die "manifest.xml not found at $MANIFEST"
  for app in "${APPS[@]}"; do
    local container="$HOME/Library/Containers/com.microsoft.$app"
    if [ ! -d "$container" ]; then
      warn "$app not found (no $container); skipping"
      continue
    fi
    mkdir -p "$(wef_dir "$app")"
    cp "$MANIFEST" "$(wef_dir "$app")/$MANIFEST_NAME"
    say "Sideloaded into $app: $(wef_dir "$app")/$MANIFEST_NAME"
  done
  echo "Restart the Office apps, then: Insert > Add-ins > My Add-ins > Developer Add-ins > Hermes for Office."
}

do_uninstall() {
  [ "$OS" = mac ] || return 0
  for app in "${APPS[@]}"; do
    local f; f="$(wef_dir "$app")/$MANIFEST_NAME"
    if [ -f "$f" ]; then rm -f "$f"; say "Removed $f"; fi
  done
}

do_deps() {
  if [ -f "$ROOT/addin/dist/index.html" ]; then
    say "Prebuilt add-in found (addin/dist); skipping npm build"
  else
    command -v node >/dev/null || die "addin/dist is missing and node is required to build it (https://nodejs.org)"
    say "Building add-in"
    (cd "$ROOT/addin" && npm install --no-audit --no-fund && npm run build)
  fi
  say "Setting up bridge virtualenv"
  local py; py="$(command -v python3 || command -v python || true)"
  [ -n "$py" ] || die "python3 is required for the bridge"
  if [ ! -x "$VENV_PY" ]; then "$py" -m venv "$ROOT/bridge/.venv"; fi
  "$VENV_PIP" install -q -r "$ROOT/bridge/requirements.txt"
}

# --------------------------------------------------------------------------- daemon

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

wait_healthy() {
  for _ in $(seq 1 20); do
    if curl -ksf "https://127.0.0.1:$PORT/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

# schtasks args start with "/", which MSYS would rewrite as paths.
schtasks_() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' schtasks "$@"; }

service_install() {
  [ -x "$VENV_PY" ] || [ -f "$VENV_PY" ] || die "bridge virtualenv missing; run ./install.sh first"
  [ -f "$CERT_DIR/localhost.crt" ] || warn "No cert at $CERT_DIR; the daemon will serve plain http/ws. Run ./install.sh certs"
  mkdir -p "$LOG_DIR"
  case "$OS" in
    mac)
      mkdir -p "$(dirname "$PLIST")"
      cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$VENV_PY")</string>
    <string>$(xml_escape "$ROOT/bridge/hermes_office_bridge.py")</string>
    <string>--port</string><string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$ROOT/bridge")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml_escape "$HOME/.local/bin:$HOME/.hermes/hermes-agent/.hermes/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")</string>
    <key>LANG</key><string>en_US.UTF-8</string>
    <key>PYTHONUTF8</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_DIR/bridge.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_DIR/bridge.log")</string>
</dict>
</plist>
EOF
      say "Wrote $PLIST"
      launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
      launchctl bootstrap "gui/$(id -u)" "$PLIST" || die "launchctl bootstrap failed"
      launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true ;;
    linux)
      command -v systemctl >/dev/null || die "systemd not found; run '$VENV_PY $ROOT/bridge/hermes_office_bridge.py' from your init system"
      mkdir -p "$(dirname "$UNIT")"
      cat > "$UNIT" <<EOF
[Unit]
Description=Hermes Office bridge + add-in server

[Service]
ExecStart="$VENV_PY" "$ROOT/bridge/hermes_office_bridge.py" --port $PORT
WorkingDirectory=$ROOT/bridge
Environment=PATH=$HOME/.local/bin:$HOME/.hermes/hermes-agent/.hermes/bin:/usr/local/bin:/usr/bin:/bin
Environment=LANG=C.UTF-8
Environment=PYTHONUTF8=1
Restart=always
RestartSec=2
StandardOutput=append:$LOG_DIR/bridge.log
StandardError=append:$LOG_DIR/bridge.log

[Install]
WantedBy=default.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable hermes-office.service >/dev/null 2>&1
      systemctl --user restart hermes-office.service
      if command -v loginctl >/dev/null; then loginctl enable-linger "$USER" >/dev/null 2>&1 || true; fi ;;
    windows)
      local pyw script
      pyw="$(cygpath -w "$VENV_PYW")"; script="$(cygpath -w "$ROOT/bridge/hermes_office_bridge.py")"
      schtasks_ /Create /F /SC ONLOGON /RL LIMITED /TN "$TASK_NAME" \
        /TR "\"$pyw\" \"$script\" --port $PORT" >/dev/null || die "schtasks /Create failed"
      schtasks_ /End /TN "$TASK_NAME" >/dev/null 2>&1 || true
      schtasks_ /Run /TN "$TASK_NAME" >/dev/null || die "schtasks /Run failed" ;;
  esac
  if wait_healthy; then say "Service running: https://localhost:$PORT/index.html (logs: $LOG_DIR/bridge.log)"
  else warn "Service did not become healthy; check $LOG_DIR/bridge.log"; fi
}

service_stop() {
  case "$OS" in
    mac)
      # bootout unloads the job so KeepAlive does not respawn it; service-start re-bootstraps.
      launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true ;;
    linux) systemctl --user stop hermes-office.service >/dev/null 2>&1 || true ;;
    windows) schtasks_ /End /TN "$TASK_NAME" >/dev/null 2>&1 || true ;;
  esac
  say "Service stopped"
}

service_uninstall() {
  service_stop
  case "$OS" in
    mac) rm -f "$PLIST" ;;
    linux)
      systemctl --user disable hermes-office.service >/dev/null 2>&1 || true
      rm -f "$UNIT"; systemctl --user daemon-reload >/dev/null 2>&1 || true ;;
    windows) schtasks_ /Delete /F /TN "$TASK_NAME" >/dev/null 2>&1 || true ;;
  esac
  say "Service removed"
}

service_start() {
  case "$OS" in
    mac)
      [ -f "$PLIST" ] || die "service not installed; run ./install.sh service-install"
      launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
      launchctl kickstart "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true ;;
    linux) systemctl --user start hermes-office.service || die "service not installed; run ./install.sh service-install" ;;
    windows) schtasks_ /Run /TN "$TASK_NAME" >/dev/null || die "service not installed; run ./install.sh service-install" ;;
  esac
  if wait_healthy; then say "Service started"; else warn "Service not healthy yet; see $LOG_DIR/bridge.log"; fi
}

service_status() {
  local installed=no manager=no health=down
  case "$OS" in
    mac)
      [ -f "$PLIST" ] && installed=yes
      launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && manager=loaded ;;
    linux)
      [ -f "$UNIT" ] && installed=yes
      systemctl --user is-active --quiet hermes-office.service && manager=active ;;
    windows)
      schtasks_ /Query /TN "$TASK_NAME" >/dev/null 2>&1 && installed=yes ;;
  esac
  curl -ksf "https://127.0.0.1:$PORT/health" >/dev/null 2>&1 && health=up
  echo "service: installed=$installed manager=$manager health(https://localhost:$PORT)=$health"
}

# --------------------------------------------------------------------------- misc

do_status() {
  if [ "$OS" = mac ]; then
    for app in "${APPS[@]}"; do
      local f; f="$(wef_dir "$app")/$MANIFEST_NAME"
      [ -f "$f" ] && echo "$app: sideloaded ($f)" || echo "$app: not sideloaded"
    done
  fi
  [ -f "$CERT_DIR/localhost.crt" ] && echo "cert: $CERT_DIR/localhost.crt" || echo "cert: missing"
  service_status
  if command -v hermes >/dev/null || [ -x "$HOME/.hermes/hermes-agent/.hermes/bin/hermes" ]; then echo "hermes: installed"; else echo "hermes: NOT found"; fi
}

do_start() {
  trap 'kill 0' EXIT INT TERM
  "$ROOT/bridge/run.sh" &
  (cd "$ROOT/addin" && npm run dev) &
  wait
}

case "$CMD" in
  install)   do_certs; do_deps; do_sideload; if [ "$SERVICE" = 1 ]; then service_install; fi; do_status ;;
  certs)     do_certs ;;
  sideload)  do_sideload ;;
  uninstall) service_uninstall; do_uninstall ;;
  status)    do_status ;;
  start)     do_start ;;
  service-install)   service_install ;;
  service-uninstall) service_uninstall ;;
  service-start)     service_start ;;
  service-stop)      service_stop ;;
  service-restart)   service_stop || true; service_start ;;
  service-status)    service_status ;;
  *) die "unknown command: $CMD" ;;
esac
