[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

function Invoke-DeveloperCommand {
    param(
        [Parameter(Mandatory = $true)][string]$VsDevCmd,
        [Parameter(Mandatory = $true)][string]$Command
    )

    $commandLine = 'call "' + $VsDevCmd + '" -arch=x64 -host_arch=x64 >nul && ' + $Command
    & cmd.exe /d /s /c $commandLine
    if ($LASTEXITCODE -ne 0) {
        throw "El comando nativo terminó con código $LASTEXITCODE."
    }
}

$vswhereCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
)
$vswhere = $vswhereCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $vswhere) {
    throw 'No se encontró Visual Studio Installer. Ejecuta tools\check-prerequisites.ps1.'
}

$visualStudioPath = & $vswhere -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $visualStudioPath) {
    throw 'No se encontró una instalación de Visual Studio con MSVC x64.'
}

$vsDevCmd = Join-Path $visualStudioPath 'Common7\Tools\VsDevCmd.bat'
$cmake = Join-Path $visualStudioPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ctest = Join-Path $visualStudioPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe'
foreach ($requiredPath in @($vsDevCmd, $cmake, $ctest)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Falta una herramienta requerida: $requiredPath"
    }
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$buildDirectory = Join-Path $projectRoot 'build\ninja'

$configureCommand = '"' + $cmake + '" -S "' + $projectRoot + '" -B "' + $buildDirectory + '" -G Ninja -DCMAKE_BUILD_TYPE=' + $Configuration
Invoke-DeveloperCommand -VsDevCmd $vsDevCmd -Command $configureCommand

$buildCommand = '"' + $cmake + '" --build "' + $buildDirectory + '" --config ' + $Configuration
Invoke-DeveloperCommand -VsDevCmd $vsDevCmd -Command $buildCommand

if (-not $SkipTests) {
    & $ctest --test-dir $buildDirectory -C $Configuration --output-on-failure
    if ($LASTEXITCODE -ne 0) {
        throw "Las pruebas nativas terminaron con código $LASTEXITCODE."
    }
}

Write-Host "QSession Windows compilado correctamente en $buildDirectory"
