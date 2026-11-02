param([string]$ImagePath, [switch]$Worker)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1
} | Select-Object -First 1
function Await-WinRT($Operation, [Type]$ResultType) {
    $task = $taskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans'))
if ($null -eq $engine) { throw 'NATIVE_OCR_CHINESE_UNAVAILABLE' }
function Recognize-Bitmap($bitmap) {
        $recognitionWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $result = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $recognitionWatch.Stop()
        $lines = @($result.Lines | ForEach-Object {
            $line = $_
            $words = @($line.Words | ForEach-Object {
                @{text=$_.Text; x=$_.BoundingRect.X; y=$_.BoundingRect.Y; width=$_.BoundingRect.Width; height=$_.BoundingRect.Height}
            })
            if ($words.Count -gt 0) {
                $left = ($words | ForEach-Object { $_.x } | Measure-Object -Minimum).Minimum
                $top = ($words | ForEach-Object { $_.y } | Measure-Object -Minimum).Minimum
                $right = ($words | ForEach-Object { $_.x + $_.width } | Measure-Object -Maximum).Maximum
                $bottom = ($words | ForEach-Object { $_.y + $_.height } | Measure-Object -Maximum).Maximum
                @{text=$line.Text; x=$left; y=$top; width=$right-$left; height=$bottom-$top; words=$words}
            }
        })
        return @{text=($result.Lines | ForEach-Object { $_.Text }) -join "`n"; lines=$lines; engine='windows'; language=$engine.RecognizerLanguage.LanguageTag; recognitionMs=$recognitionWatch.ElapsedMilliseconds}
}

if ($Worker) {
    # Lower scheduling priority applies only to this helper, not the game.
    try { [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal' } catch {}
    $inputStream = [Console]::OpenStandardInput()
    $pixels = $null
    [Console]::Out.WriteLine('{"ready":true,"protocol":1}')
    [Console]::Out.Flush()
    while ($true) {
        # Read the header from the byte stream as well. Mixing ReadLine() and
        # binary reads would lose bytes to the text reader's internal buffer.
        $headerBytes = [System.Collections.Generic.List[byte]]::new()
        while ($true) {
            $next = $inputStream.ReadByte()
            if ($next -lt 0) { exit 0 }
            if ($next -eq 10) { break }
            if ($headerBytes.Count -ge 1024) { throw 'NATIVE_OCR_HEADER_LIMIT' }
            $headerBytes.Add([byte]$next)
        }
        $request = [Text.Encoding]::UTF8.GetString($headerBytes.ToArray()) | ConvertFrom-Json
        if ($request.id -isnot [int] -or $request.id -le 0 -or
            $request.width -isnot [int] -or $request.height -isnot [int] -or
            $request.width -le 0 -or $request.height -le 0 -or $request.width -gt 2200 -or $request.height -gt 2200 -or
            $request.byteLength -ne ($request.width * $request.height * 4)) { throw 'NATIVE_OCR_INVALID_FRAME' }
        if ($null -eq $pixels -or $pixels.Length -ne $request.byteLength) { $pixels = [byte[]]::new($request.byteLength) }
        $offset = 0
        while ($offset -lt $pixels.Length) {
            $read = $inputStream.Read($pixels, $offset, $pixels.Length - $offset)
            if ($read -le 0) { exit 0 }
            $offset += $read
        }
        $bitmap = $null
        try {
            $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::new([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
                $request.width, $request.height, [Windows.Graphics.Imaging.BitmapAlphaMode]::Ignore)
            $bitmap.CopyFromBuffer([System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($pixels))
            $response = Recognize-Bitmap $bitmap
            $response.id = $request.id
            $response.ok = $true
        } catch {
            # Never put paths, pixels, or arbitrary native exception text on the
            # parent protocol. A failed read is retried through the fallback.
            $response = @{id=$request.id;ok=$false;error='NATIVE_OCR_FAILED'}
        } finally {
            if ($null -ne $bitmap) { $bitmap.Dispose() }
        }
        [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 6))
        [Console]::Out.Flush()
    }
} else {
    # Keep the single-image CLI for offline fixtures and existing tooling.
    if ([string]::IsNullOrWhiteSpace($ImagePath)) { throw 'NATIVE_OCR_IMAGE_REQUIRED' }
    $imageFile = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRT ($imageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try { Recognize-Bitmap $bitmap | ConvertTo-Json -Compress -Depth 6 }
        finally { $bitmap.Dispose() }
    } finally { $stream.Dispose() }
}
