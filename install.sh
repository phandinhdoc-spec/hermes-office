#!/usr/bin/env bash
# Hermes Office setup / sideload / daemon CLI (macOS; service commands also Linux + Windows Git Bash).
#
#   ./install.sh [install]   certs + deps + manifest sideload + install and start the background service
#   ./install.sh certs       (re)generate and trust the localhost dev certificate
#   ./install.sh sideload    copy manifest.xml into the Word/Excel/PowerPoint wef folders (macOS)
#   ./install.sh uninstall   remove the service and the sideloaded manifests (keeps certs)
#   ./install.sh status      show what is installed
#   ./install.sh office      (Linux) install LibreOffice when no office suite is present
#   ./install.sh plugin      enable the Hermes plugin antigravity-subscription-directsdk (agy installed + signed in first)
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
#        --yes | -y    non-interactive: answer "yes" to every question
#        --lang vi|en  language of the questions (default: asked, or vi without a terminal)
# `install` first asks (numbered/[Y/n] questions) whether to download Hermes Agent and Antigravity
# when they are missing; sign in with Google afterwards inside the Office add-in.
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

ASSUME_YES=0
LANG_UI=""
HERMES_INSTALL_URL="${HERMES_INSTALL_URL:-https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh}"
AGY_INSTALL_URL="${AGY_INSTALL_URL:-}"   # no public one-line installer known: we point to the download page
AGY_DOWNLOAD_PAGE="https://antigravity.google/download"
# Hermes plugin that serves Gemini through the signed-in agy account (empty = skip the plugin step).
HERMES_AGY_PLUGIN="${HERMES_AGY_PLUGIN-antigravity-subscription-directsdk}"
PLUGIN_MARKER="$HOME/.hermes-office/plugin-enabled"   # read by the bridge: plugin already enabled by Hermes Office
case "$HERMES_AGY_PLUGIN" in -*) echo "invalid HERMES_AGY_PLUGIN: $HERMES_AGY_PLUGIN" >&2; exit 1 ;; esac
prev=""
for a in "$@"; do
  [ "$a" = "--no-trust" ] && TRUST=0
  [ "$a" = "--no-service" ] && SERVICE=0
  { [ "$a" = "--yes" ] || [ "$a" = "-y" ]; } && ASSUME_YES=1
  [ "$prev" = "--lang" ] && LANG_UI="$a"
  prev="$a"
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

# --------------------------------------------------------------------------- friendly prompts

if [ -z "$LANG_UI" ]; then
  if [ "$ASSUME_YES" = 1 ] || [ ! -t 0 ]; then LANG_UI=vi
  else
    printf '\n  Ngon ngu / Language:\n    1) Tieng Viet\n    2) English\n  Chon / Choose [1]: '
    read -r _l || _l=1
    case "$_l" in 2|en|EN) LANG_UI=en ;; *) LANG_UI=vi ;; esac
  fi
fi
tr_() { if [ "$LANG_UI" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

# ask "<vi question>" "<en question>"  -> 0 for yes (default), 1 for no
ask() {
  [ "$ASSUME_YES" = 1 ] && return 0
  [ -t 0 ] || return 0
  local ans
  printf '\n\033[1m? %s [Y/n]\033[0m ' "$(tr_ "$1" "$2")"
  read -r ans || ans=y
  case "$ans" in n|N|no|NO|khong|không) return 1 ;; *) return 0 ;; esac
}

hermes_present() { command -v hermes >/dev/null 2>&1 || [ -x "$HOME/.hermes/hermes-agent/.hermes/bin/hermes" ] || [ -x "$HOME/.local/bin/hermes" ]; }
agy_present() { command -v agy >/dev/null 2>&1 || [ -x "$HOME/.local/bin/agy" ]; }

# Runs a downloaded installer script (https only) with bash, showing its output.
run_remote_installer() {
  local url="$1" tmp
  case "$url" in https://*) ;; *) return 1 ;; esac
  tmp="$(mktemp)"
  local rc=0
  if curl -fsSL "$url" -o "$tmp"; then bash "$tmp" || rc=$?; rm -f "$tmp"; return $rc; fi
  rm -f "$tmp"; return 1
}

setup_agents() {
  say "$(tr_ 'Kiem tra Hermes Agent va Antigravity...' 'Checking Hermes Agent and Antigravity...')"
  if hermes_present; then
    say "Hermes Agent: $(tr_ 'da co' 'already installed')"
  elif ask "Ban co muon tu dong tai & cai Hermes Agent khong?" "Download and install Hermes Agent automatically?"; then
    command -v curl >/dev/null || die "$(tr_ 'Can co curl de tai Hermes.' 'curl is required to download Hermes.')"
    run_remote_installer "$HERMES_INSTALL_URL" || warn "$(tr_ 'Cai Hermes chua thanh cong. Ban co the cai lai trong tien ich Office (nut Cai tu dong).' 'Hermes install did not finish. You can retry from inside the Office add-in.')"
  else
    warn "$(tr_ 'Bo qua Hermes. Tien ich se hien nut cai dat khi ban mo no.' 'Skipped Hermes. The add-in will offer to install it when you open it.')"
  fi
  if agy_present; then
    say "Antigravity (agy): $(tr_ 'da co' 'already installed')"
  elif ask "Ban co muon cai Antigravity (agy) khong? (tuy chon)" "Install Antigravity (agy)? (optional)"; then
    if [ -n "$AGY_INSTALL_URL" ]; then run_remote_installer "$AGY_INSTALL_URL" || warn "Antigravity: $(tr_ 'cai that bai' 'install failed')"
    else
      warn "$(tr_ "Hay tai Antigravity tai: $AGY_DOWNLOAD_PAGE (khong bat buoc de dung tien ich)." "Please download Antigravity from: $AGY_DOWNLOAD_PAGE (not required to use the add-in).")"
      case "$OS" in mac) command -v open >/dev/null && open "$AGY_DOWNLOAD_PAGE" || true ;; linux) command -v xdg-open >/dev/null && xdg-open "$AGY_DOWNLOAD_PAGE" >/dev/null 2>&1 || true ;; esac
    fi
  fi
  enable_plugin
}

libreoffice_present() { command -v soffice >/dev/null 2>&1 || command -v libreoffice >/dev/null 2>&1; }

# Linux has no Microsoft Office: offer LibreOffice (Writer/Calc/Impress) instead.
# Uses the distro's package manager (sudo needed unless already root).
setup_office() {
  [ "$OS" = linux ] || return 0
  if libreoffice_present; then
    say "LibreOffice: $(tr_ 'da co' 'already installed')"
    return 0
  fi
  say "$(tr_ 'Linux khong co Microsoft Office. Co the cai LibreOffice (Writer, Calc, Impress) de thay the.' 'Linux has no Microsoft Office. LibreOffice (Writer, Calc, Impress) can be installed instead.')"
  ask "Ban co muon cai LibreOffice khong?" "Install LibreOffice?" || { warn "$(tr_ 'Bo qua LibreOffice.' 'Skipped LibreOffice.')"; return 0; }
  local sudo_=""
  if [ "$(id -u)" != 0 ]; then
    command -v sudo >/dev/null || { warn "$(tr_ 'Can sudo hoac quyen root de cai LibreOffice.' 'sudo or root is required to install LibreOffice.')"; return 0; }
    sudo_="sudo"
  fi
  local rc=0
  if command -v apt-get >/dev/null; then
    $sudo_ apt-get update && $sudo_ apt-get install -y libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-l10n-vi || rc=$?
  elif command -v dnf >/dev/null; then
    $sudo_ dnf install -y libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-langpack-vi || rc=$?
  elif command -v pacman >/dev/null; then
    $sudo_ pacman -S --needed --noconfirm libreoffice-fresh || rc=$?
  elif command -v zypper >/dev/null; then
    $sudo_ zypper --non-interactive install libreoffice-writer libreoffice-calc libreoffice-impress || rc=$?
  elif command -v flatpak >/dev/null; then
    flatpak install -y flathub org.libreoffice.LibreOffice || rc=$?
  else
    warn "$(tr_ 'Khong nhan ra trinh quan ly goi. Hay cai LibreOffice thu cong: https://www.libreoffice.org/download/' 'Unknown package manager. Install LibreOffice manually: https://www.libreoffice.org/download/')"
    return 0
  fi
  if [ "$rc" = 0 ]; then say "$(tr_ 'Da cai LibreOffice.' 'LibreOffice installed.')"
  else warn "$(tr_ 'Cai LibreOffice chua thanh cong. Ban co the cai lai bang tay.' 'LibreOffice install did not finish. You can install it manually.')"; fi
}

hermes_bin() {
  local c
  for c in "$(command -v hermes 2>/dev/null || true)" "$HOME/.hermes/hermes-agent/.hermes/bin/hermes" "$HOME/.local/bin/hermes"; do
    if [ -n "$c" ] && [ -x "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}

# Antigravity plugin for Hermes: needs the agy CLI installed and signed in first, then
#   hermes plugins enable antigravity-subscription-directsdk
# Afterwards the bridge routes fast (inline) edits through that provider with gemini-3.8-flash.
enable_plugin() {
  [ -n "$HERMES_AGY_PLUGIN" ] || return 0
  local h; h="$(hermes_bin)" || return 0
  if ! agy_present; then
    warn "$(tr_ "Chua co Antigravity (agy) nen chua bat plugin $HERMES_AGY_PLUGIN. Hay cai agy, dang nhap vao agy, roi chay: ./install.sh plugin" "agy is not installed, so plugin $HERMES_AGY_PLUGIN is not enabled yet. Install agy, sign in to it, then run: ./install.sh plugin")"
    return 0
  fi
  if [ "$(cat "$PLUGIN_MARKER" 2>/dev/null || true)" = "$HERMES_AGY_PLUGIN" ]; then
    say "$(tr_ "Plugin $HERMES_AGY_PLUGIN: da bat" "Plugin $HERMES_AGY_PLUGIN: already enabled")"
    return 0
  fi
  if ask "Ban co muon bat plugin Antigravity ($HERMES_AGY_PLUGIN) trong Hermes khong? (can agy da dang nhap)" "Enable the Antigravity plugin ($HERMES_AGY_PLUGIN) in Hermes? (agy must be signed in)"; then
    if "$h" plugins enable "$HERMES_AGY_PLUGIN"; then
      mkdir -p "$(dirname "$PLUGIN_MARKER")"
      printf '%s' "$HERMES_AGY_PLUGIN" > "$PLUGIN_MARKER"
      say "$(tr_ "Da bat plugin $HERMES_AGY_PLUGIN." "Enabled plugin $HERMES_AGY_PLUGIN.")"
    else
      warn "$(tr_ "Bat plugin that bai. Hay dang nhap agy roi chay lai: ./install.sh plugin" "Could not enable the plugin. Sign in to agy, then run: ./install.sh plugin")"
    fi
  fi
}

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
  if hermes_present; then echo "hermes: installed"; else echo "hermes: NOT found"; fi
  if [ "$OS" = linux ]; then if libreoffice_present; then echo "libreoffice: installed"; else echo "libreoffice: NOT found (optional; ./install.sh office)"; fi; fi
  if agy_present; then echo "agy: installed"; else echo "agy: NOT found (optional)"; fi
  if [ -n "$HERMES_AGY_PLUGIN" ]; then
    if [ "$(cat "$PLUGIN_MARKER" 2>/dev/null || true)" = "$HERMES_AGY_PLUGIN" ]; then echo "plugin $HERMES_AGY_PLUGIN: enabled"; else echo "plugin $HERMES_AGY_PLUGIN: not enabled (needs agy signed in; run ./install.sh plugin)"; fi
  fi
}

final_message() {
  echo
  say "$(tr_ 'Xong! Buoc cuoi: mo Word/Excel/PowerPoint > Insert > Add-ins > Hermes for Office, roi bam "Dang nhap bang tai khoan Google".' 'Done! Last step: open Word/Excel/PowerPoint > Insert > Add-ins > Hermes for Office, then click "Sign in with Google account".')"
}

do_start() {
  trap 'kill 0' EXIT INT TERM
  "$ROOT/bridge/run.sh" &
  (cd "$ROOT/addin" && npm run dev) &
  wait
}

case "$CMD" in
  install)   setup_office; setup_agents; do_certs; do_deps; do_sideload; if [ "$SERVICE" = 1 ]; then service_install; fi; do_status; final_message ;;
  certs)     do_certs ;;
  sideload)  do_sideload ;;
  uninstall) service_uninstall; do_uninstall ;;
  status)    do_status ;;
  office)    setup_office ;;
  plugin)    enable_plugin ;;
  start)     do_start ;;
  service-install)   service_install ;;
  service-uninstall) service_uninstall ;;
  service-start)     service_start ;;
  service-stop)      service_stop ;;
  service-restart)   service_stop || true; service_start ;;
  service-status)    service_status ;;
  *) die "unknown command: $CMD" ;;
esac
