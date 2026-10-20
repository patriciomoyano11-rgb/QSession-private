[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
try { Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop }
catch { Add-Type -AssemblyName System.Drawing }

function Export-QSessionPng {
    param(
        [string]$SourcePath,
        [string]$DestinationPath,
        [int]$Size
    )

    $source = [System.Drawing.Image]::FromFile($SourcePath)
    $result = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($result)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($source, 0, 0, $Size, $Size)
    $result.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $result.Dispose()
    $source.Dispose()
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot '..')).Path
$source = Join-Path $workspaceRoot 'platform\public\brand\qsession-icon-master.png'
$lightMark = Join-Path $workspaceRoot 'platform\public\icons\qsession-mark-light.png'
$contrastMark = Join-Path $workspaceRoot 'platform\public\icons\qsession-mark-contrast.png'
$serverIcons = Join-Path $workspaceRoot 'platform\public\icons'
$assets = Join-Path $projectRoot 'assets'

# Este archivo es la única fuente visual y se copia sin modificar.
Copy-Item -LiteralPath $source -Destination (Join-Path $assets 'qsession-brand-master.png') -Force

Export-QSessionPng $source (Join-Path $serverIcons 'qsession-icon-512.png') 512
Export-QSessionPng $source (Join-Path $serverIcons 'qsession-icon-192.png') 192
Export-QSessionPng $lightMark (Join-Path $assets 'qsession-mark.png') 512
Export-QSessionPng $contrastMark (Join-Path $assets 'qsession-mark-contrast.png') 512
Export-QSessionPng $source (Join-Path $assets 'qsession-app-icon.png') 1024
Export-QSessionPng $source (Join-Path $assets 'qsession-icon.png') 1254

$densities = [ordered]@{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
foreach ($density in $densities.Keys) {
    $directory = Join-Path $projectRoot "android\app\src\main\res\mipmap-$density"
    Export-QSessionPng $source (Join-Path $directory 'ic_launcher.png') $densities[$density]
    Export-QSessionPng $source (Join-Path $directory 'ic_launcher_round.png') $densities[$density]
}

Write-Host 'Todos los iconos Android y web fueron derivados del maestro Q Session.'
