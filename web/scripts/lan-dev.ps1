<#
.SYNOPSIS
  Run the Athar web app on your LOCAL NETWORK so a phone or another computer on the same Wi-Fi can open it (iPhone / Safari WebP testing).

.DESCRIPTION
  1. Finds this computer's LAN IPv4 address (the adapter that has a default gateway; virtual adapters of WSL / Hyper-V / Docker / VPNs are skipped).
  2. Sets VITE_SUPABASE_URL FOR THIS PROCESS ONLY to http://<that ip>:54321 so the app opened on the phone talks to the local Supabase stack
     running on this computer (web/.env.local is NOT touched; the phone cannot reach 127.0.0.1 because that is the phone itself).
  3. Starts Vite with --host on port 5400 (--strictPort: if 5400 is busy it stops instead of silently using another port).
  4. Prints the address to type on the phone and the exact Windows Firewall command you MAY run yourself. This script never changes the firewall.

  Stop it with Ctrl+C. Nothing is installed and no file is written.

.PARAMETER Ip
  Use this address instead of the detected one (when the computer has several networks).

.PARAMETER Port
  The web app port (default 5400).

.PARAMETER SupabasePort
  The local Supabase API port (default 54321, as in local-db/README.md).

.PARAMETER DryRun
  Only print what would be done (address, URLs, firewall command); start nothing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File web\scripts\lan-dev.ps1
  npm run dev:lan                      (from the web folder)
  npm run dev:lan -- -Ip 192.168.1.7   (choose the address yourself)
#>
[CmdletBinding()]
param(
  [string]$Ip = '',
  [int]$Port = 5400,
  [int]$SupabasePort = 54321,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$webDir = Split-Path -Parent $PSScriptRoot
$virtual = 'vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback|Bluetooth|TAP-|Tailscale|ZeroTier|Npcap|Pseudo'

function Test-PrivateIPv4([string]$address) {
  if ($address -match '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') {
    $a = [int]$Matches[1]; $b = [int]$Matches[2]
  } else {
    return $false
  }
  return ($a -eq 10) -or ($a -eq 172 -and $b -ge 16 -and $b -le 31) -or ($a -eq 192 -and $b -eq 168)
}

# ---- 1. the LAN address -----------------------------------------------------------------------------------------------------------------
$candidates = @()
try {
  $candidates = @(Get-NetIPConfiguration -ErrorAction Stop |
    Where-Object { $_.IPv4Address -and $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.InterfaceAlias -notmatch $virtual } |
    Sort-Object { $_.NetIPv4Interface.InterfaceMetric } |
    ForEach-Object { [pscustomobject]@{ Address = [string]$_.IPv4Address[0].IPAddress; Alias = $_.InterfaceAlias } })
} catch {
  $candidates = @()
}
if (-not $candidates.Count) {
  # fallback: any non-virtual IPv4 address that is not loopback / link-local
  $candidates = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch $virtual } |
    ForEach-Object { [pscustomobject]@{ Address = [string]$_.IPAddress; Alias = $_.InterfaceAlias } })
}

if ($Ip) {
  $chosen = [pscustomobject]@{ Address = $Ip; Alias = '(given with -Ip)' }
} elseif ($candidates.Count) {
  $chosen = $candidates[0]
} else {
  Write-Host ''
  Write-Host 'No LAN address found. Connect to Wi-Fi / Ethernet, or pass it yourself:  npm run dev:lan -- -Ip 192.168.x.x' -ForegroundColor Red
  exit 1
}
$ip = $chosen.Address

Write-Host ''
Write-Host 'Athar web app on the local network' -ForegroundColor Cyan
Write-Host '----------------------------------'
Write-Host ("Network adapter : {0}" -f $chosen.Alias)
Write-Host ("LAN address     : {0}" -f $ip)
if ($candidates.Count -gt 1 -and -not $PSBoundParameters.ContainsKey('Ip')) {
  Write-Host ('Other addresses : ' + (($candidates | Select-Object -Skip 1 | ForEach-Object { '{0} ({1})' -f $_.Address, $_.Alias }) -join ', ') + '   (use -Ip to pick one)')
}
if (-not (Test-PrivateIPv4 $ip)) {
  Write-Host ("Warning: {0} is not a private network address (10.x / 172.16-31.x / 192.168.x). Check that it is the Wi-Fi your phone is on." -f $ip) -ForegroundColor Yellow
}

# the network profile decides which firewall profile the rule must be in
$profileName = 'Private'
try {
  $conn = Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.InterfaceAlias -eq $chosen.Alias } | Select-Object -First 1
  if ($conn) { $profileName = [string]$conn.NetworkCategory }
} catch {
  $profileName = 'Private'
}

$supabaseUrl = 'http://{0}:{1}' -f $ip, $SupabasePort
$phoneUrl = 'http://{0}:{1}' -f $ip, $Port

# ---- 2. is the local Supabase stack reachable on that address? --------------------------------------------------------------------------
$reachable = $false
try {
  $client = New-Object System.Net.Sockets.TcpClient
  $task = $client.ConnectAsync($ip, $SupabasePort)
  $reachable = $task.Wait(2000) -and $client.Connected
  $client.Close()
} catch {
  $reachable = $false
}
if ($reachable) {
  Write-Host ("Supabase (local): {0}  reachable" -f $supabaseUrl) -ForegroundColor Green
} else {
  Write-Host ("Supabase (local): {0}  NOT reachable from here." -f $supabaseUrl) -ForegroundColor Yellow
  Write-Host '                  Start the local stack first:  cd local-db\stack ; npx supabase start -x logflare,vector,imgproxy,edge-runtime,mailpit'
  Write-Host '                  (the image-check page works without it; the rest of the app needs it)'
}
if (-not (Select-String -Path (Join-Path $webDir '.env.local') -Pattern '^VITE_SUPABASE_ANON_KEY=' -Quiet -ErrorAction SilentlyContinue)) {
  Write-Host 'Note: web\.env.local has no VITE_SUPABASE_ANON_KEY; the app will show its configuration screen (the image-check page still works).' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'On the phone (same Wi-Fi), open:' -ForegroundColor Cyan
Write-Host ("  {0}/dev/image-check     <- the image diagnostics page" -f $phoneUrl) -ForegroundColor Green
Write-Host ("  {0}/                    <- the app" -f $phoneUrl)
Write-Host ''
Write-Host 'If the phone cannot open it, Windows Firewall is probably blocking the two ports.' -ForegroundColor Cyan
Write-Host 'This script does NOT change the firewall. To allow them, open PowerShell AS ADMINISTRATOR and run:' -ForegroundColor Cyan
Write-Host ('  New-NetFirewallRule -DisplayName "Athar dev LAN ({0}, {1})" -Direction Inbound -Action Allow -Protocol TCP -LocalPort {0},{1} -Profile {2}' -f $Port, $SupabasePort, $profileName)
Write-Host 'Remove it again when you are done testing:'
Write-Host ('  Remove-NetFirewallRule -DisplayName "Athar dev LAN ({0}, {1})"' -f $Port, $SupabasePort)
if ($profileName -eq 'Public') {
  Write-Host 'Your Wi-Fi is set to "Public": Windows blocks incoming connections on it by default. Prefer switching it to Private (Settings > Network) over opening it.' -ForegroundColor Yellow
}
Write-Host ''

if ($DryRun) {
  Write-Host 'Dry run: nothing was started.' -ForegroundColor Yellow
  exit 0
}

# ---- 3. start Vite for THIS process only (web/.env.local is not edited; a variable that is already set wins over the .env files) -----------
$env:VITE_SUPABASE_URL = $supabaseUrl
Write-Host ("VITE_SUPABASE_URL = {0}  (this process only)" -f $supabaseUrl)
Write-Host 'Starting Vite... press Ctrl+C to stop.' -ForegroundColor Cyan
Write-Host ''
# the local Vite binary is started with node directly (an npx shim can lose its first argument when PowerShell is started without a console)
$vite = Join-Path (Join-Path (Join-Path (Join-Path $webDir 'node_modules') 'vite') 'bin') 'vite.js'
if (-not (Test-Path $vite)) {
  Write-Host 'Vite is not installed: run  npm install  in the web folder first.' -ForegroundColor Red
  exit 1
}
Push-Location $webDir
try {
  & node $vite --mode development --host --port $Port --strictPort
} finally {
  Pop-Location
}
