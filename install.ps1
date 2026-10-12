# Hermes for Office - Windows installer. Double-click install.bat (or run: powershell -ExecutionPolicy Bypass -File install.ps1)
# Installs missing prerequisites (Git, Python, Node) with winget after asking, offers Hermes Agent and
# Antigravity, then runs install.sh (certs, build, daemon) through Git Bash and registers the add-in.
param([switch]$Yes, [ValidateSet('vi','en','')][string]$Lang = '')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$HermesUrl = if ($env:HERMES_INSTALL_URL) { $env:HERMES_INSTALL_URL } else { 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh' }
$AgyPage = 'https://antigravity.google/download'

if (-not $Lang) {
  if ($Yes) { $Lang = 'vi' } else {
    Write-Host "`n  Ngon ngu / Language:`n    1) Tieng Viet`n    2) English"
    $a = Read-Host '  Chon / Choose [1]'
    $Lang = if ($a -eq '2') { 'en' } else { 'vi' }
  }
}
function T($vi, $en) { if ($Lang -eq 'en') { $en } else { $vi } }
function Say($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ask($vi, $en) {
  if ($Yes) { return $true }
  $a = Read-Host "`n? $(T $vi $en) [Y/n]"
  return -not ($a -match '^(n|no|khong)$')
}
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Ensure($cmd, $wingetId, $vi, $en) {
  if (Have $cmd) { Say "$cmd : $(T 'da co' 'already installed')"; return }
  if (-not (Have 'winget')) { throw (T "Thieu $cmd va may khong co winget. Hay cai $cmd thu cong roi chay lai." "$cmd is missing and winget is unavailable. Install $cmd manually and re-run.") }
  if (Ask $vi $en) {
    winget install --id $wingetId -e --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (-not (Have $cmd)) { throw (T "Da cai $cmd nhung chua dung duoc. Hay dong cua so nay va chay lai install.bat." "$cmd was installed but is not on PATH yet. Close this window and run install.bat again.") }
  } else { throw (T "Can $cmd de tiep tuc." "$cmd is required to continue.") }
}

Say (T 'Cai dat Hermes cho Office' 'Installing Hermes for Office')
Ensure 'git'    'Git.Git'              'Ban co muon tu dong cai Git khong? (can thiet)'        'Install Git automatically? (required)'
Ensure 'python' 'Python.Python.3.12'   'Ban co muon tu dong cai Python khong? (can thiet)'     'Install Python automatically? (required)'
if (-not (Test-Path (Join-Path $Root 'addin\dist\index.html'))) {
  Ensure 'node' 'OpenJS.NodeJS.LTS'    'Ban co muon tu dong cai Node.js khong? (can de bien dich giao dien)' 'Install Node.js automatically? (needed to build the UI)'
}

# Hermes Agent: official installer runs under Git Bash (use WSL if you prefer the Linux build).
# Find Git Bash ourselves (Git may be installed but missing from PATH, or per-user): PATH, registry, default folders.
function Find-GitBash {
  $roots = @()
  $g = Get-Command git -ErrorAction SilentlyContinue
  if ($g) { $roots += (Split-Path -Parent (Split-Path -Parent $g.Source)) }   # ...\Git\cmd\git.exe -> ...\Git
  foreach ($k in 'HKLM:\SOFTWARE\GitForWindows','HKCU:\SOFTWARE\GitForWindows','HKLM:\SOFTWARE\WOW6432Node\GitForWindows') {
    $p = (Get-ItemProperty $k -ErrorAction SilentlyContinue).InstallPath
    if ($p) { $roots += $p }
  }
  foreach ($pf in $env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs')) { if ($pf) { $roots += (Join-Path $pf 'Git') } }
  foreach ($r in $roots) {
    if (-not $r) { continue }
    $b = Join-Path $r 'bin\bash.exe'
    if (Test-Path $b) { return $b }
  }
  return $null   # not the WSL bash in System32: it cannot run install.sh with Windows paths
}
$bash = Find-GitBash
if (-not $bash) { throw (T 'Khong tim thay Git Bash (bash.exe di kem Git for Windows). Hay cai lai Git roi chay lai install.bat.' 'Git Bash (bash.exe from Git for Windows) not found. Reinstall Git and run install.bat again.') }
# Put Git's own tools (openssl, cygpath, ...) first on PATH so install.sh never depends on what else is installed.
$gitRoot = Split-Path -Parent (Split-Path -Parent $bash)
$env:Path = (Join-Path $gitRoot 'usr\bin') + ';' + (Join-Path $gitRoot 'bin') + ';' + $env:Path
Say "Git Bash: $bash"
$hasHermes = (Have 'hermes') -or (Test-Path "$HOME\.hermes\hermes-agent\.hermes\bin\hermes*") -or (Test-Path "$HOME\.local\bin\hermes*")
if ($hasHermes) { Say "Hermes Agent: $(T 'da co' 'already installed')" }
elseif (Ask 'Ban co muon tu dong tai & cai Hermes Agent khong?' 'Download and install Hermes Agent automatically?') {
  try {
    $tmp = Join-Path $env:TEMP 'hermes-install.sh'
    Invoke-WebRequest -UseBasicParsing -Uri $HermesUrl -OutFile $tmp
    & $bash $tmp
  } catch { Write-Warning (T 'Cai Hermes chua thanh cong. Ban co the cai lai trong tien ich Office (nut Cai tu dong).' 'Hermes install did not finish. You can retry from the Office add-in.') }
} else { Write-Warning (T 'Bo qua Hermes; tien ich se hien nut cai dat khi ban mo no.' 'Skipped Hermes; the add-in will offer to install it.') }

if (-not (Have 'agy') -and -not (Test-Path "$HOME\.local\bin\agy*")) {
  if (Ask 'Ban co muon cai Antigravity (agy) khong? (tuy chon)' 'Install Antigravity (agy)? (optional)') {
    Write-Warning (T "Hay tai Antigravity tai: $AgyPage (khong bat buoc)." "Please download Antigravity from: $AgyPage (optional).")
    Start-Process $AgyPage
  }
}

# certs, build, background task: reuse install.sh
Say (T 'Dang cai dich vu chay ngam...' 'Setting up the background service...')
$unix = ($Root -replace '\\','/')
$env:CHERE_INVOKING = '1'   # keep the working directory in the login shell
& $bash -lc "cd '$unix' && ./install.sh install --yes --lang $Lang"
if ($LASTEXITCODE -ne 0) {
  $log = Join-Path $env:USERPROFILE '.hermes-office\openssl.log'
  if (Test-Path $log) { Write-Host (T "--- Chi tiet loi openssl ($log) ---" "--- openssl error details ($log) ---") -ForegroundColor Yellow; Get-Content $log -Tail 20 }
  throw (T 'install.sh bao loi; xem thong bao phia tren.' 'install.sh reported an error; see messages above.')
}

# Register the add-in manifest in a local shared catalog so Office lists it under Shared Folder.
try {
  $dir = Join-Path $env:USERPROFILE '.hermes-office\catalog'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item (Join-Path $Root 'manifest.xml') (Join-Path $dir 'hermes-office.manifest.xml') -Force
  if (-not (Get-SmbShare -Name 'HermesOfficeCatalog' -ErrorAction SilentlyContinue)) { New-SmbShare -Name 'HermesOfficeCatalog' -Path $dir -ReadAccess $env:USERNAME | Out-Null }
  $key = 'HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{7B6D1C5E-4F0A-4D0E-9A53-0123456789AB}'
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty $key -Name Id -Value '{7B6D1C5E-4F0A-4D0E-9A53-0123456789AB}'
  Set-ItemProperty $key -Name Url -Value "\\$env:COMPUTERNAME\HermesOfficeCatalog"
  Set-ItemProperty $key -Name Flags -Value 1 -Type DWord
  Say (T 'Da dang ky tien ich voi Office.' 'Add-in registered with Office.')
} catch {
  Write-Warning (T 'Khong tu dang ky duoc tien ich (can quyen quan tri de tao thu muc chia se). Xem HDSD_CAI_DAT.md muc "Them thu cong".' 'Could not auto-register the add-in (admin rights are needed to create the share). See HDSD_CAI_DAT.md, "Manual add".')
}

Write-Host ''
Say (T 'Xong! Mo Word/Excel/PowerPoint > Insert > Add-ins > Shared Folder > Hermes for Office, roi bam "Dang nhap bang tai khoan Google".' 'Done! Open Word/Excel/PowerPoint > Insert > Add-ins > Shared Folder > Hermes for Office, then click "Sign in with Google account".')
