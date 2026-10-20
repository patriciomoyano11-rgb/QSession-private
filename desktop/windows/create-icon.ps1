[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
try { Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop }
catch { Add-Type -AssemblyName System.Drawing }

$desktopRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $desktopRoot
$sourcePath = (Resolve-Path -LiteralPath (Join-Path $workspaceRoot 'platform\public\brand\qsession-icon-master.png')).Path
$assetDirectory = Join-Path $PSScriptRoot 'QSession.Host\Assets'
$iconPath = Join-Path $assetDirectory 'qsession.ico'
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null

$images = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $source = [System.Drawing.Image]::FromFile($sourcePath)
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $stream = [System.IO.MemoryStream]::new()
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $images += [pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() }
    $stream.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    $source.Dispose()
}

$file = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$images.Count)
$offset = 6 + (16 * $images.Count)
foreach ($image in $images) {
    $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$image.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $image.Bytes.Length
}
foreach ($image in $images) { $writer.Write($image.Bytes) }
$writer.Dispose()
$file.Dispose()

Write-Host "Icono Q Session listo: $iconPath"
