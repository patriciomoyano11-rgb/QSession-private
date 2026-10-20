[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$androidRoot = $PSScriptRoot
$workspaceRoot = (Resolve-Path (Join-Path $androidRoot '..\..')).Path
$gradleFile = Join-Path $androidRoot 'app\build.gradle'
$source = Get-Content -LiteralPath $gradleFile -Raw
$versionMatch = [regex]::Match($source, 'versionName\s+"(?<version>\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)"')
if (-not $versionMatch.Success) { throw 'No se pudo leer versionName desde app/build.gradle.' }
$version = $versionMatch.Groups['version'].Value
$packageVersion = (Get-Content -LiteralPath (Join-Path $workspaceRoot 'mobile\package.json') -Raw | ConvertFrom-Json).version
if ($packageVersion -ne $version) { throw "La versión Android $version no coincide con mobile/package.json $packageVersion." }

Push-Location $androidRoot
try {
  & '.\gradlew.bat' ':app:assembleRelease'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la APK firmada de producción.' }
} finally {
  Pop-Location
}

$artifact = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
& node (Join-Path $workspaceRoot 'platform\scripts\update-app-release.cjs') android $version $artifact
if ($LASTEXITCODE -ne 0) { throw 'No se pudo actualizar el catálogo de Android.' }

Write-Host "Android $version listo para publicar y registrado como última versión."
