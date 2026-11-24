param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\VKAutomobiles'),
  [string]$DesktopDirectory = [Environment]::GetFolderPath('Desktop')
)
$ErrorActionPreference = 'Stop'
try {
  $label = Split-Path -Leaf $PSScriptRoot
  $resolvedRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
  $target = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $label))
  if (-not $target.StartsWith($resolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid install target.' }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'App') -Force | Copy-Item -Destination $target -Recurse -Force
  New-Item -ItemType Directory -Path $DesktopDirectory -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path $DesktopDirectory 'VK Automobiles.lnk'))
  $shortcut.TargetPath = Join-Path $target 'VK Automobiles.exe'
  $shortcut.WorkingDirectory = $target
  $shortcut.Description = 'Open VK AutoMobiles - offline shop management'
  $shortcut.Save()
  $maintenance = Join-Path $target 'Maintenance'
  New-Item -ItemType Directory -Path $maintenance -Force | Out-Null
  foreach ($action in @('Stop','Restart','Status')) {
    $link = $shell.CreateShortcut((Join-Path $maintenance ($action + ' shop.lnk')))
    $link.TargetPath = Join-Path $target 'VK Automobiles.exe'
    $link.Arguments = '--' + $action.ToLowerInvariant()
    $link.WorkingDirectory = $target
    $link.Save()
  }
  Write-Host 'Installed. Double-click VK Automobiles on the desktop. The browser opens when the shop is ready.'
  Write-Host ('Maintenance controls: ' + $maintenance)
  Write-Host 'For updates: save work, download a backup, use Stop shop, then open the new desktop shortcut.'
  Write-Host 'Shop records remain in LocalAppData\VKAutomobiles\data. No Windows startup task was installed.'
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
