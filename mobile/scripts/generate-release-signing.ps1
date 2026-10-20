[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function New-QSessionSecret {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(36)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot '..')).Path
$jdkCandidates = @(
    $env:JAVA_HOME,
    (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr')
) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin\keytool.exe')) }
$jdkRoot = $jdkCandidates | Select-Object -First 1
if (-not $jdkRoot) {
    $java = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($java) { $jdkRoot = Split-Path -Parent (Split-Path -Parent $java.Source) }
}
if (-not $jdkRoot) { throw 'No se encontró un JDK. Configura JAVA_HOME o instala Android Studio.' }

$keytool = Join-Path $jdkRoot 'bin\keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw "No se encontró keytool: $keytool" }

$privateDirectory = Join-Path $workspaceRoot 'private\android-signing'
$keystorePath = Join-Path $privateDirectory 'qsession-release.jks'
$certificatePath = Join-Path $privateDirectory 'qsession-release-public.cer'
$recoveryPath = Join-Path $privateDirectory 'QSESSION-ANDROID-CLAVE-DE-RECUPERACION.txt'
$propertiesPath = Join-Path $projectRoot 'android\signing.properties'

foreach ($protectedPath in @($keystorePath, $recoveryPath, $propertiesPath)) {
    if (Test-Path -LiteralPath $protectedPath) {
        throw "La firma definitiva ya existe y no será reemplazada: $protectedPath"
    }
}

New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
$password = New-QSessionSecret
$alias = 'qsession'
$secretEnvironmentName = 'QSESSION_ANDROID_SIGNING_SECRET'

function Invoke-Keytool {
    param([string[]]$Arguments)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $keytool
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment[$secretEnvironmentName] = $password
    foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $standardOutput = $process.StandardOutput.ReadToEnd()
    $standardError = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "keytool terminó con código $($process.ExitCode): $standardError $standardOutput"
    }
}

try {
    Invoke-Keytool @(
        '-genkeypair',
        '-keystore', $keystorePath,
        '-storetype', 'PKCS12',
        '-storepass:env', $secretEnvironmentName,
        '-keypass:env', $secretEnvironmentName,
        '-alias', $alias,
        '-keyalg', 'RSA',
        '-keysize', '4096',
        '-sigalg', 'SHA256withRSA',
        '-validity', '10000',
        '-dname', 'CN=Q Session, OU=Mobile, O=Q Session'
    )

    Invoke-Keytool @(
        '-exportcert',
        '-keystore', $keystorePath,
        '-storepass:env', $secretEnvironmentName,
        '-alias', $alias,
        '-file', $certificatePath
    )

    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
    $rawFingerprint = $certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $fingerprint = (($rawFingerprint -split '(..)' | Where-Object { $_ }) -join ':')

    $relativeStore = '../../private/android-signing/qsession-release.jks'
    $properties = @(
        "storeFile=$relativeStore",
        "storePassword=$password",
        "keyAlias=$alias",
        "keyPassword=$password"
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText($propertiesPath, $properties + [Environment]::NewLine)

    $recovery = @(
        'Q SESSION · FIRMA DEFINITIVA DE ANDROID',
        'NO PUBLICAR. NO ENVIAR POR MENSAJERÍA. CONSERVAR DOS COPIAS SEGURAS.',
        '',
        "Archivo: $keystorePath",
        "Alias: $alias",
        "Contraseña del almacén: $password",
        "Contraseña de la clave: $password",
        "Paquete Android: org.qsession.app",
        "Huella SHA-256: $fingerprint",
        '',
        'Esta clave debe utilizarse para todas las futuras versiones de Q Session y para Google Play.'
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText($recoveryPath, $recovery + [Environment]::NewLine)

    Write-Output "KEYSTORE=$keystorePath"
    Write-Output "RECOVERY=$recoveryPath"
    Write-Output "FINGERPRINT=$fingerprint"
}
catch {
    foreach ($incompletePath in @($keystorePath, $certificatePath, $recoveryPath, $propertiesPath)) {
        if (Test-Path -LiteralPath $incompletePath) { Remove-Item -LiteralPath $incompletePath -Force }
    }
    throw
}
finally {
    $password = $null
}
