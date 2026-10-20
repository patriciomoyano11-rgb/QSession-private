[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
$nativeProject = Join-Path $projectRoot 'native-media'
$nativeRoot = Join-Path $nativeProject 'build\ninja'
$project = Join-Path $PSScriptRoot 'QSession.Host\QSession.Host.csproj'
$output = Join-Path $projectRoot 'build\windows-x64'
$installerOutput = Join-Path $projectRoot 'build\windows-installer'
$installer = Join-Path $projectRoot 'build\Instalar-QSession-Windows.exe'
$env:DOTNET_CLI_HOME = Join-Path $projectRoot '.dotnet-cli'
$env:NUGET_PACKAGES = Join-Path $projectRoot '.nuget\packages'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

& (Join-Path $nativeProject 'tools\build-native.ps1') -Configuration Release

foreach ($library in @('QSession.Audio.dll', 'livekit.dll', 'livekit_ffi.dll')) {
    $path = Join-Path $nativeRoot $library
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Falta el motor multimedia nativo: $path"
    }
}

& (Join-Path $PSScriptRoot 'create-icon.ps1')

dotnet publish $project -c Release -r win-x64 --self-contained true -o $output --ignore-failed-sources --property:NuGetAudit=false
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar Q Session Desktop.' }

dotnet publish $project -c Release -r win-x64 --self-contained true --no-restore -o $installerOutput --property:NuGetAudit=false --property:QSessionSelfInstaller=true
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el instalador único de Q Session.' }

if (Test-Path -LiteralPath $installer) {
    Remove-Item -LiteralPath $installer -Force
}
Move-Item -LiteralPath (Join-Path $installerOutput 'QSession.Host.exe') -Destination $installer
[xml]$projectDefinition = Get-Content -LiteralPath $project
$version = @($projectDefinition.Project.PropertyGroup.Version | Where-Object { $_ })[0]
if (-not $version) { throw 'No se pudo leer la versión del proyecto Windows.' }
& node (Join-Path $workspaceRoot 'platform\scripts\update-app-release.cjs') windows $version $installer
if ($LASTEXITCODE -ne 0) { throw 'No se pudo actualizar el catálogo de Windows.' }

Write-Host "Q Session Desktop listo: $(Join-Path $output 'QSession.Host.exe')"
Write-Host "Instalador para compartir: $installer"
Write-Host "Descarga web y catálogo actualizados: Windows $version"
