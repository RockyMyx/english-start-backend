param(
  [string]$ImagePath = (Join-Path $PSScriptRoot '../images/membership-year.png'),
  [int]$MaxBytes = 180000
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$resolvedImagePath = (Resolve-Path -LiteralPath $ImagePath).Path
$original = [System.Drawing.Image]::FromFile($resolvedImagePath)
$compressed = $null
$selectedSize = 0

try {
  foreach ($size in @(512, 448, 384, 320, 256)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $stream = New-Object System.IO.MemoryStream
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($original, 0, 0, $size, $size)
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      if ($stream.Length -le $MaxBytes) {
        $compressed = $stream.ToArray()
        $selectedSize = $size
        break
      }
    } finally {
      $stream.Dispose()
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
} finally {
  $original.Dispose()
}

if ($null -eq $compressed) {
  throw "Cannot compress the product image below $MaxBytes bytes. Original file unchanged."
}

[System.IO.File]::WriteAllBytes($resolvedImagePath, $compressed)
Write-Output "Compressed: $resolvedImagePath ($selectedSize x $selectedSize, $($compressed.Length) bytes)"
