[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
try { Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop }
catch { Add-Type -AssemblyName System.Drawing }

function Export-QSessionArtwork {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [Parameter(Mandatory = $true)][int]$Size,
        [Parameter(Mandatory = $true)][double]$SymbolScale,
        [System.Drawing.Color]$DiscColor = [System.Drawing.Color]::Transparent,
        [switch]$SolidBackground
    )

    $source = [System.Drawing.Image]::FromFile($SourcePath)
    $canvas = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    if ($DiscColor.A -gt 0) {
        $brush = [System.Drawing.SolidBrush]::new($DiscColor)
        if ($SolidBackground) {
            $graphics.FillRectangle($brush, 0, 0, $Size, $Size)
        }
        else {
            $graphics.FillEllipse($brush, 1, 1, $Size - 2, $Size - 2)
        }
        $brush.Dispose()
    }

    $targetWidth = [double]$Size * $SymbolScale
    $targetHeight = $targetWidth * ([double]$source.Height / [double]$source.Width)
    $targetX = ([double]$Size - $targetWidth) / 2
    $targetY = ([double]$Size - $targetHeight) / 2
    $graphics.DrawImage($source, [single]$targetX, [single]$targetY, [single]$targetWidth, [single]$targetHeight)

    $destinationDirectory = Split-Path -Parent $DestinationPath
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    $canvas.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $graphics.Dispose()
    $canvas.Dispose()
    $source.Dispose()
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$brandDirectory = Join-Path $projectRoot 'public\brand'
$iconDirectory = Join-Path $projectRoot 'public\icons'
$symbolMaster = Join-Path $brandDirectory 'qsession-symbol-master.png'
$windowsIconMaster = Join-Path $brandDirectory 'qsession-windows-icon-master.png'
$brandBlue = [System.Drawing.Color]::FromArgb(255, 6, 41, 87)

Export-QSessionArtwork $symbolMaster (Join-Path $brandDirectory 'qsession-icon-master.png') 2048 0.86 $brandBlue
# The Windows master is intentionally curated separately for legibility at taskbar size.
# Preserve it and only derive the browser-app icon from that approved artwork.
if (-not (Test-Path -LiteralPath $windowsIconMaster)) {
    throw "Falta el icono maestro de Windows: $windowsIconMaster"
}
Export-QSessionArtwork $windowsIconMaster (Join-Path $iconDirectory 'qsession-windows-icon-192.png') 192 1.0
Export-QSessionArtwork $symbolMaster (Join-Path $iconDirectory 'qsession-mark-light.png') 512 0.86
Export-QSessionArtwork $symbolMaster (Join-Path $iconDirectory 'qsession-mark-contrast.png') 512 0.86 $brandBlue
Export-QSessionArtwork $symbolMaster (Join-Path $iconDirectory 'qsession-icon-192.png') 192 0.86 $brandBlue
Export-QSessionArtwork $symbolMaster (Join-Path $iconDirectory 'qsession-icon-512.png') 512 0.86 $brandBlue
Export-QSessionArtwork $symbolMaster (Join-Path $iconDirectory 'qsession-icon-maskable-512.png') 512 0.70 $brandBlue -SolidBackground

Write-Host 'Identidad Q Session generada para web, Android y Windows.'
