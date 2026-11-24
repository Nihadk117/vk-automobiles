$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $appRoot
$env:SHOP_DATABASE_PATH = Join-Path $appRoot 'data\shop.sqlite'
$env:NEXT_TELEMETRY_DISABLED = '1'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js is required for this development launcher.' }
& $nodePath 'scripts\start.mjs'
