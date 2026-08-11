# Generates the HEWStudio app icon:
#   build/icon.png  - 512x512 master
#   build/icon.ico  - multi-size (256/128/64/48/32/24/16), PNG-compressed entries
#
# Pure System.Drawing (no node-gyp / MSVC needed). Re-run after any tweak to
# the drawing below:  powershell -ExecutionPolicy Bypass -File scripts/generate-icon.ps1

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$primaryTop = [System.Drawing.Color]::FromArgb(255, 0x0b, 0x57, 0xd0)
$primaryBottom = [System.Drawing.Color]::FromArgb(255, 0x08, 0x42, 0xa0)
$white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)

function New-RoundedRectPath([System.Drawing.RectangleF]$rect, [float]$radius) {
    $path = New-Object -TypeName System.Drawing.Drawing2D.GraphicsPath
    $d = [float](2.0 * $radius)
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-WorkStudioBitmap([int]$size) {
    $bmp = New-Object -TypeName System.Drawing.Bitmap -ArgumentList @(
        $size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $f = [float]$size

    # Rounded-square background with a subtle vertical gradient.
    $inset = [float](0.047 * $f)
    $bgW = [float]($f - 2.0 * $inset)
    $bgRect = New-Object -TypeName System.Drawing.RectangleF -ArgumentList @(
        $inset, $inset, $bgW, $bgW)
    $bgPath = New-RoundedRectPath $bgRect ([float](0.19 * $f))
    $grad = New-Object -TypeName System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
        $bgRect, $primaryTop, $primaryBottom, [float]90.0)
    $g.FillPath($grad, $bgPath)

    # Lock body (white rounded rect).
    $bw = [float](0.52 * $f)
    $bh = [float](0.42 * $f)
    $bx = [float](($f - $bw) / 2.0)
    $by = [float](0.375 * $f)
    $bodyRect = New-Object -TypeName System.Drawing.RectangleF -ArgumentList @(
        $bx, $by, $bw, $bh)
    $bodyPath = New-RoundedRectPath $bodyRect ([float](0.07 * $f))
    $whiteBrush = New-Object -TypeName System.Drawing.SolidBrush -ArgumentList @($white)
    $g.FillPath($whiteBrush, $bodyPath)

    # Shackle (rounded arc over the body top).
    $arcHalf = [float](0.19 * $f)
    $arcCX = [float]($f / 2.0)
    $arcCY = $by
    $arcRect = New-Object -TypeName System.Drawing.RectangleF -ArgumentList @(
        [float]($arcCX - $arcHalf), [float]($arcCY - $arcHalf),
        [float](2.0 * $arcHalf), [float](2.0 * $arcHalf))
    $pen = New-Object -TypeName System.Drawing.Pen -ArgumentList @(
        $white, [float](0.085 * $f))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($pen, $arcRect, 180, 180)

    # Keyhole (circle + stem), cut out in the primary color.
    $kh = New-Object -TypeName System.Drawing.SolidBrush -ArgumentList @($primaryTop)
    $kCircleR = [float](0.075 * $f)
    $kCircleCY = [float]($by + 0.42 * $bh)
    $g.FillEllipse($kh, [float]($arcCX - $kCircleR), [float]($kCircleCY - $kCircleR),
        [float](2.0 * $kCircleR), [float](2.0 * $kCircleR))
    $stemW = [float](0.07 * $f)
    $g.FillRectangle($kh, [float]($arcCX - $stemW / 2.0), $kCircleCY, $stemW, [float](0.44 * $bh))

    $g.Dispose()
    return $bmp
}

function Save-Ico([string]$path, [System.Drawing.Bitmap[]]$images) {
    # PNG-compressed entries: self-describing orientation (no bottom-up DIB
    # ambiguity that some viewers mis-render), smaller, and the format modern
    # icon tools use. Windows Vista+ and electron-builder both handle it.
    $count = $images.Count
    $stream = New-Object -TypeName System.IO.MemoryStream
    $bw = New-Object -TypeName System.IO.BinaryWriter -ArgumentList @($stream)
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$count)

    $data = New-Object 'System.Collections.Generic.List[byte[]]'
    $offset = 6 + 16 * $count
    foreach ($bmp in $images) {
        $w = $bmp.Width
        $wVal = $w
        if ($w -ge 256) { $wVal = 0 }
        $wByte = [byte]$wVal
        $pngStream = New-Object -TypeName System.IO.MemoryStream
        $bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBytes = $pngStream.ToArray()
        $bw.Write([byte]$wByte)              # width  (0 = 256)
        $bw.Write([byte]$wByte)              # height (0 = 256)
        $bw.Write([byte]0)                   # palette
        $bw.Write([byte]0)                   # reserved
        $bw.Write([uint16]1)                 # color planes
        $bw.Write([uint16]32)                # bits per pixel
        $bw.Write([uint32]$pngBytes.Length)  # size of the PNG blob
        $bw.Write([uint32]$offset)           # offset
        $offset += $pngBytes.Length
        $data.Add($pngBytes)
    }
    foreach ($png in $data) {
        $stream.Write($png, 0, $png.Length)
    }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($path, $stream.ToArray())
    $bw.Dispose()
}

$outDir = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$master = New-WorkStudioBitmap 512
$master.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

$sizes = @(256, 128, 64, 48, 32, 24, 16)
$images = @()
foreach ($s in $sizes) {
    $images += New-Object -TypeName System.Drawing.Bitmap -ArgumentList @($master, $s, $s)
}
Save-Ico (Join-Path $outDir 'icon.ico') $images

Write-Host "Wrote build/icon.png (512) and build/icon.ico ($($sizes -join ','))"
