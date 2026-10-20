[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $desktopRoot 'build\windows-x64'
$sourceExecutable = Join-Path $sourceDirectory 'QSession.Host.exe'
if (-not (Test-Path -LiteralPath $sourceExecutable)) {
    throw 'Primero debes compilar Q Session Desktop con windows\build.ps1.'
}

$programsRoot = Join-Path $env:LOCALAPPDATA 'Programs'
$installDirectory = Join-Path $programsRoot 'QSession'
$stagingDirectory = Join-Path $programsRoot 'QSession.next'
$backupDirectory = Join-Path $programsRoot 'QSession.previous'
$resolvedProgramsRoot = [System.IO.Path]::GetFullPath($programsRoot).TrimEnd('\') + '\'
$resolvedInstallDirectory = [System.IO.Path]::GetFullPath($installDirectory)
$resolvedStagingDirectory = [System.IO.Path]::GetFullPath($stagingDirectory)
$resolvedBackupDirectory = [System.IO.Path]::GetFullPath($backupDirectory)

foreach ($path in @($resolvedInstallDirectory, $resolvedStagingDirectory, $resolvedBackupDirectory)) {
    if (-not $path.StartsWith($resolvedProgramsRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "La ruta de instalación no pertenece al perfil local: $path"
    }
}

if (Test-Path -LiteralPath $resolvedStagingDirectory) {
    Remove-Item -LiteralPath $resolvedStagingDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedStagingDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $sourceDirectory -Force |
    Copy-Item -Destination $resolvedStagingDirectory -Recurse -Force

$stagedExecutable = Join-Path $resolvedStagingDirectory 'QSession.Host.exe'
foreach ($required in @(
    'QSession.Host.exe',
    'QSession.Audio.dll',
    'livekit.dll',
    'livekit_ffi.dll',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.Wpf.dll',
    'WebView2Loader.dll'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedStagingDirectory $required))) {
        throw "La instalación preparada no contiene $required."
    }
}

Get-Process -Name 'QSession.Host' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $installedExecutablePath = Join-Path $resolvedInstallDirectory 'QSession.Host.exe'
        if ([string]::Equals($_.Path, $installedExecutablePath, [StringComparison]::OrdinalIgnoreCase)) {
            $_.Kill()
            $_.WaitForExit(5000)
        }
    } catch { }
}

if (Test-Path -LiteralPath $resolvedBackupDirectory) {
    Remove-Item -LiteralPath $resolvedBackupDirectory -Recurse -Force
}

try {
    if (Test-Path -LiteralPath $resolvedInstallDirectory) {
        Move-Item -LiteralPath $resolvedInstallDirectory -Destination $resolvedBackupDirectory
    }
    Move-Item -LiteralPath $resolvedStagingDirectory -Destination $resolvedInstallDirectory
} catch {
    if (-not (Test-Path -LiteralPath $resolvedInstallDirectory) -and (Test-Path -LiteralPath $resolvedBackupDirectory)) {
        Move-Item -LiteralPath $resolvedBackupDirectory -Destination $resolvedInstallDirectory
    }
    throw
}

$installedExecutable = Join-Path $resolvedInstallDirectory 'QSession.Host.exe'
$shell = New-Object -ComObject WScript.Shell
$desktopDirectory = [Environment]::GetFolderPath('Desktop')
$startMenuDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Q Session'
New-Item -ItemType Directory -Path $startMenuDirectory -Force | Out-Null

foreach ($shortcutPath in @(
    (Join-Path $desktopDirectory 'Q Session.lnk'),
    (Join-Path $startMenuDirectory 'Q Session.lnk')
)) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $installedExecutable
    $shortcut.WorkingDirectory = $resolvedInstallDirectory
    $shortcut.Description = 'Q Session Desktop · transmisión para anfitriones'
    $shortcut.IconLocation = "$installedExecutable,0"
    $shortcut.Save()
}

if (Test-Path -LiteralPath $resolvedBackupDirectory) {
    Remove-Item -LiteralPath $resolvedBackupDirectory -Recurse -Force
}

Write-Output "INSTALL_PATH=$resolvedInstallDirectory"
Write-Output "EXECUTABLE=$installedExecutable"
Write-Output "DESKTOP_SHORTCUT=$(Join-Path $desktopDirectory 'Q Session.lnk')"
Write-Output "START_MENU_SHORTCUT=$(Join-Path $startMenuDirectory 'Q Session.lnk')"
