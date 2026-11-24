param(
  [ValidateSet('Start','Stop','Restart','Status')][string]$Action = 'Start',
  [switch]$NoBrowser,
  [switch]$Quiet,
  [ValidateRange(5,120)][int]$StartupTimeoutSeconds = 45
)
$ErrorActionPreference = 'Stop'
$mutex = $null
$locked = $false
$spawned = $null
$specPath = $null
function Show-Message([string]$Text, [bool]$Failure = $false) {
  if ($Quiet) { return }
  Add-Type -AssemblyName System.Windows.Forms
  $icon = if ($Failure) { [Windows.Forms.MessageBoxIcon]::Error } else { [Windows.Forms.MessageBoxIcon]::Information }
  [void][Windows.Forms.MessageBox]::Show($Text, 'VK AutoMobiles', [Windows.Forms.MessageBoxButtons]::OK, $icon)
}
function Read-State {
  if (-not (Test-Path -LiteralPath $statePath)) { return $null }
  try { return Get-Content -LiteralPath $statePath -Encoding UTF8 -Raw | ConvertFrom-Json } catch { throw 'The launcher state file is unreadable. Do not start another copy. Open the logs folder for assistance.' }
}
function Get-OwnedProcess($Record) {
  if (-not $Record -or $Record.databasePath -ne $databasePath) { return $null }
  $process = Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$Record.startedTicks) { return $null }
  if ([IO.Path]::GetFullPath($process.Path) -ne [string]$Record.runtimePath) { return $null }
  $command = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$Record.pid)
  $exePattern = [regex]::Escape([string]$Record.runtimePath)
  $serverPattern = [regex]::Escape([string]$Record.serverPath)
  $expectedCommand = '^(?:"' + $exePattern + '"|' + $exePattern + ')\s+(?:"' + $serverPattern + '"|' + $serverPattern + ')\s*$'
  if (-not $command -or $command.CommandLine -notmatch $expectedCommand) { return $null }
  return $process
}
function Port-InUse([int]$Number) {
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Number)
  try { $listener.Start(); return $false } catch { return $true } finally { $listener.Stop() }
}
function Healthy($Record) {
  try {
    $health = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $Record.port + '/api/health') -TimeoutSec 1
    return $health.status -eq 'ok' -and $health.database -eq 'connected' -and $health.app -eq 'vk-automobiles' -and $health.instance -eq $Record.instance -and $health.version -eq $Record.version
  } catch { return $false }
}
function Stop-Owned($Record, [bool]$Confirm) {
  $process = Get-OwnedProcess $Record
  if (-not $process) {
    # A recycled PID must never cause an unrelated process to be stopped.
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    return $false
  }
  if ($Confirm -and -not $Quiet) {
    Add-Type -AssemblyName System.Windows.Forms
    $choice = [Windows.Forms.MessageBox]::Show('Save your work and download a backup before stopping. Any unsaved forms will be lost. Stop the shop application now?', 'VK AutoMobiles', [Windows.Forms.MessageBoxButtons]::YesNo, [Windows.Forms.MessageBoxIcon]::Question)
    if ($choice -ne [Windows.Forms.DialogResult]::Yes) { throw 'Stop cancelled. The shop application is still running.' }
  }
  $process.Kill()
  if (-not $process.WaitForExit(10000)) { throw 'The application did not stop. Do not start another copy.' }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  return $true
}
try {
  $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launcher.json') -Encoding UTF8 -Raw | ConvertFrom-Json
  $port = [int]$config.port
  if ($port -lt 1024 -or $port -gt 65535) { throw 'The launcher port is invalid.' }
  $runtimePath = if ([IO.Path]::IsPathRooted($config.runtimePath)) { [IO.Path]::GetFullPath($config.runtimePath) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $config.runtimePath)) }
  $serverPath = if ([IO.Path]::IsPathRooted($config.serverPath)) { [IO.Path]::GetFullPath($config.serverPath) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $config.serverPath)) }
  $databasePath = $env:SHOP_DATABASE_PATH
  if (-not $databasePath) { $databasePath = $config.databasePath }
  if (-not $databasePath) { $databasePath = Join-Path $env:LOCALAPPDATA 'VKAutomobiles\data\shop.sqlite' }
  $databasePath = [IO.Path]::GetFullPath($databasePath)
  $databaseFile = [IO.Path]::GetFileName($databasePath)
  $supportName = if ($databaseFile -eq 'shop.sqlite') { 'launcher' } else { 'launcher-' + $databaseFile }
  $support = Join-Path (Split-Path -Parent $databasePath) $supportName
  New-Item -ItemType Directory -Path $support -Force | Out-Null
  $statePath = Join-Path $support 'instance.json'
  $logPath = Join-Path $support 'launcher.log'
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $key = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($databasePath.ToLowerInvariant())))).Replace('-','') } finally { $hash.Dispose() }
  $mutex = New-Object Threading.Mutex($false, ("Local\VKAutomobiles-" + $key))
  try { $locked = $mutex.WaitOne(60000) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Another launcher is still starting or stopping the shop. Wait a moment and retry.' }
  $record = Read-State
  $existing = Get-OwnedProcess $record
  if ($Action -eq 'Status') {
    $status = if ($existing -and (Healthy $record)) { 'Running on http://127.0.0.1:' + $record.port } elseif ($existing) { 'A managed process is running but is not ready. Open the logs folder.' } else { 'Not running through this launcher.' }
    Show-Message $status
    Write-Output $status
    exit 0
  }
  if ($Action -eq 'Stop' -or $Action -eq 'Restart') {
    $stopped = Stop-Owned $record $true
    if ($Action -eq 'Stop') { Show-Message $(if ($stopped) { 'The shop application is stopped.' } else { 'No launcher-managed instance was running. Other applications were left alone.' }); exit 0 }
    $record = $null; $existing = $null
  }
  if ($existing) {
    if ($record.appRoot -ne $PSScriptRoot -or $record.port -ne $port -or $record.version -ne $config.version) { throw 'Another installed version of this shop is running. Save your work, use Stop shop in the Maintenance folder, then open the updated shortcut.' }
    if (-not (Healthy $record)) { throw 'The shop process is running but is not responding. Save any work you can, then use Restart shop in the Maintenance folder. Diagnostic logs are beside the database in the launcher folder.' }
  } else {
    if (Port-InUse $port) { throw ("Port " + $port + ' is already in use. Close the older shop console if one is open, or ask for help. The launcher will not stop or reuse an unverified application.') }
    if (-not (Test-Path -LiteralPath $runtimePath) -or -not (Test-Path -LiteralPath $serverPath)) { throw 'Application files are missing. Extract the complete ZIP, then run Install.cmd again.' }
    foreach ($name in @('launcher.log','backend-output.log','backend-error.log')) {
      $path = Join-Path $support $name
      if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt 2MB) { Move-Item -LiteralPath $path -Destination ($path + '.previous') -Force }
    }
    $instance = [guid]::NewGuid().ToString('N')
    $specPath = Join-Path $support ('start-' + $instance + '.json')
    $spec = @{serverPath=$serverPath;databasePath=$databasePath;port=$port;instance=$instance;stdout=(Join-Path $support 'backend-output.log');stderr=(Join-Path $support 'backend-error.log')}
    [IO.File]::WriteAllText($specPath, ($spec | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    $started = & $runtimePath (Join-Path $PSScriptRoot 'start-background.mjs') $specPath
    if ($LASTEXITCODE -ne 0) { throw 'The backend could not be started. Check backend-error.log in the launcher folder.' }
    $spawned = ($started | ConvertFrom-Json).pid
    $process = Get-Process -Id ([int]$spawned) -ErrorAction Stop
    $record = @{pid=[int]$spawned;startedTicks=$process.StartTime.ToUniversalTime().Ticks.ToString();runtimePath=$runtimePath;serverPath=$serverPath;databasePath=$databasePath;port=$port;instance=$instance;appRoot=$PSScriptRoot;version=$config.version}
    $pendingState = $statePath + '.pending'
    [IO.File]::WriteAllText($pendingState, ($record | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $pendingState -Destination $statePath -Force
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    while (-not (Healthy $record)) {
      if (-not (Get-OwnedProcess $record)) { throw 'The application stopped during startup. Check backend-error.log in the launcher folder.' }
      if ([DateTime]::UtcNow -ge $deadline) { throw 'Startup took too long. The application was not opened. Check the launcher logs and retry.' }
      Start-Sleep -Milliseconds 300
    }
    $spawned = $null
  }
  if (-not $NoBrowser) { Start-Process -FilePath ("http://127.0.0.1:" + $port + '/shop/home') }
  Write-Output ('Ready: http://127.0.0.1:' + $port + '/shop/home')
  exit 0
} catch {
  $message = $_.Exception.Message
  if ($spawned -and $record -and $record.pid -eq $spawned) { try { Stop-Owned $record $false } catch {} }
  if ($logPath) { try { Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o) + ' ' + $message) } catch {} }
  Show-Message ($message + "`r`n`r`nYour saved stock and bills have not been deleted.") $true
  Write-Error $message -ErrorAction Continue
  exit 1
} finally {
  if ($specPath -and (Test-Path -LiteralPath $specPath)) { Remove-Item -LiteralPath $specPath -Force -ErrorAction SilentlyContinue }
  if ($locked) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
