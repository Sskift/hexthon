$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# Independent implementation using documented User32 and System.Drawing APIs.
# No activation, input, injection, PrintWindow, recording or disk image output.
# https://learn.microsoft.com/dotnet/api/system.drawing.graphics.copyfromscreen
try {
Add-Type -ReferencedAssemblies 'System.dll','System.Drawing.dll' -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class HexthonRoiCapture {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    public sealed class Result {
        public int Width, Height, Pid, Dpi, ClientX, ClientY, ClientWidth, ClientHeight;
        public int PixelX, PixelY, PixelWidth, PixelHeight;
        public double DurationMs;
        public byte[] Bytes;
    }
    static void Reject(string code) { throw new InvalidOperationException(code); }
    static uint Validate(IntPtr hwnd) {
        if (!IsWindow(hwnd)) Reject("WINDOW_UNAVAILABLE");
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        if (pid == 0 || pid > Int32.MaxValue) Reject("WINDOW_UNAVAILABLE");
        using (var process = Process.GetProcessById((int)pid)) {
            if (!String.Equals(process.ProcessName, "League of Legends", StringComparison.OrdinalIgnoreCase)) Reject("NOT_LEAGUE");
        }
        if (!IsWindowVisible(hwnd)) Reject("NOT_VISIBLE");
        if (IsIconic(hwnd)) Reject("MINIMIZED");
        if (GetForegroundWindow() != hwnd) Reject("NOT_FOREGROUND");
        return pid;
    }
    static void Geometry(IntPtr hwnd, out Rect rect, out Point point) {
        point = new Point();
        if (!GetClientRect(hwnd, out rect) || !ClientToScreen(hwnd, ref point)) Reject("WINDOW_UNAVAILABLE");
        if (rect.Right <= rect.Left || rect.Bottom <= rect.Top || rect.Right - rect.Left > 16384 || rect.Bottom - rect.Top > 16384) Reject("CAPTURE_LIMIT");
    }
    public static Result Capture(string handle, double x, double y, double width, double height, int maxWidth) {
        long number;
        if (!Int64.TryParse(handle, out number) || number <= 0) { Reject("REQUEST_INVALID"); }
        foreach (double value in new double[] { x, y, width, height }) if (Double.IsNaN(value) || Double.IsInfinity(value)) Reject("REQUEST_INVALID");
        if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1 || maxWidth < 1 || maxWidth > 2200) Reject("REQUEST_INVALID");
        IntPtr hwnd = new IntPtr(number);
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) previous = SetThreadDpiAwarenessContext(new IntPtr(-3));
        if (previous == IntPtr.Zero) Reject("DPI_UNAVAILABLE");
        try {
            var watch = Stopwatch.StartNew();
            uint pid = Validate(hwnd);
            Rect client; Point origin; Geometry(hwnd, out client, out origin);
            uint dpi = GetDpiForWindow(hwnd); if (dpi < 48 || dpi > 960) Reject("DPI_UNAVAILABLE");
            int clientWidth = client.Right - client.Left, clientHeight = client.Bottom - client.Top;
            int left = (int)Math.Floor(x * clientWidth), top = (int)Math.Floor(y * clientHeight);
            int right = Math.Min(clientWidth, (int)Math.Ceiling((x + width) * clientWidth));
            int bottom = Math.Min(clientHeight, (int)Math.Ceiling((y + height) * clientHeight));
            int cropWidth = right - left, cropHeight = bottom - top;
            if (cropWidth < 1 || cropHeight < 1 || (long)cropWidth * cropHeight > 16777216) Reject("CAPTURE_LIMIT");
            int screenX = origin.X + left, screenY = origin.Y + top;
            int virtualX = GetSystemMetrics(76), virtualY = GetSystemMetrics(77);
            int virtualWidth = GetSystemMetrics(78), virtualHeight = GetSystemMetrics(79);
            if (screenX < virtualX || screenY < virtualY || (long)screenX + cropWidth > (long)virtualX + virtualWidth || (long)screenY + cropHeight > (long)virtualY + virtualHeight) Reject("OFFSCREEN");
            double scale = Math.Min(1, Math.Min((double)maxWidth / cropWidth, 2200.0 / cropHeight));
            int outputWidth = Math.Max(1, (int)Math.Floor(cropWidth * scale));
            int outputHeight = Math.Max(1, (int)Math.Floor(cropHeight * scale));
            using (var source = new Bitmap(cropWidth, cropHeight, PixelFormat.Format32bppArgb)) {
                // Copy only this known client ROI. Recheck focus immediately
                // before copying and discard it if focus/geometry changed.
                if (Validate(hwnd) != pid) Reject("WINDOW_CHANGED");
                using (var graphics = Graphics.FromImage(source)) {
                    graphics.CopyFromScreen(screenX, screenY, 0, 0, new Size(cropWidth, cropHeight), CopyPixelOperation.SourceCopy);
                }
                Rect after; Point afterOrigin; Geometry(hwnd, out after, out afterOrigin);
                if (Validate(hwnd) != pid || afterOrigin.X != origin.X || afterOrigin.Y != origin.Y ||
                    after.Right - after.Left != clientWidth || after.Bottom - after.Top != clientHeight || GetDpiForWindow(hwnd) != dpi) Reject("WINDOW_CHANGED");
                using (var output = new Bitmap(outputWidth, outputHeight, PixelFormat.Format32bppArgb)) {
                    using (var graphics = Graphics.FromImage(output)) {
                        graphics.CompositingMode = CompositingMode.SourceCopy;
                        graphics.CompositingQuality = CompositingQuality.HighSpeed;
                        graphics.InterpolationMode = InterpolationMode.Bilinear;
                        graphics.SmoothingMode = SmoothingMode.None;
                        graphics.PixelOffsetMode = PixelOffsetMode.HighSpeed;
                        graphics.DrawImage(source, new Rectangle(0, 0, outputWidth, outputHeight));
                    }
                    var area = new Rectangle(0, 0, outputWidth, outputHeight);
                    BitmapData locked = output.LockBits(area, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    byte[] bytes = new byte[outputWidth * outputHeight * 4];
                    try {
                        int rowLength = outputWidth * 4;
                        for (int row = 0; row < outputHeight; row++) Marshal.Copy(IntPtr.Add(locked.Scan0, row * locked.Stride), bytes, row * rowLength, rowLength);
                    } finally { output.UnlockBits(locked); }
                    for (int index = 3; index < bytes.Length; index += 4) bytes[index] = 255;
                    watch.Stop();
                    return new Result { Width=outputWidth, Height=outputHeight, Pid=(int)pid, Dpi=(int)dpi,
                        ClientX=origin.X, ClientY=origin.Y, ClientWidth=clientWidth, ClientHeight=clientHeight,
                        PixelX=left, PixelY=top, PixelWidth=cropWidth, PixelHeight=cropHeight, Bytes=bytes, DurationMs=watch.Elapsed.TotalMilliseconds };
                }
            }
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
}
'@
} catch { exit 1 }

$inputStream = [Console]::OpenStandardInput()
$outputStream = [Console]::OpenStandardOutput()
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
function Read-Exact([int]$Length) {
    $buffer = [byte[]]::new($Length)
    $offset = 0
    while ($offset -lt $Length) {
        $count = $inputStream.Read($buffer, $offset, $Length - $offset)
        if ($count -eq 0) {
            if ($offset -eq 0) { return $null }
            throw 'TRUNCATED_FRAME'
        }
        $offset += $count
    }
    return ,$buffer
}
function Write-Reply($Header, [byte[]]$Pixels) {
    $json = $utf8.GetBytes(($Header | ConvertTo-Json -Depth 5 -Compress))
    if ($json.Length -gt 8192) { throw 'HEADER_LIMIT' }
    $prefix = [BitConverter]::GetBytes([uint32]$json.Length)
    $outputStream.Write($prefix, 0, $prefix.Length)
    $outputStream.Write($json, 0, $json.Length)
    if ($Pixels.Length -gt 0) { $outputStream.Write($Pixels, 0, $Pixels.Length) }
    $outputStream.Flush()
}
while ($true) {
    $requestId = 0
    try {
        $prefix = Read-Exact 4
        if ($null -eq $prefix) { break }
        $size = [BitConverter]::ToUInt32($prefix, 0)
        if ($size -lt 2 -or $size -gt 4096) { break }
        $body = Read-Exact ([int]$size)
        if ($null -eq $body) { break }
        $request = $utf8.GetString($body) | ConvertFrom-Json
        if ($null -eq $request.id -or [double]$request.id -lt 1 -or [double]$request.id -gt 9007199254740991 -or [double]$request.id -ne [double][long]$request.id) { throw 'REQUEST_INVALID' }
        $requestId = [long]$request.id
        if ($null -eq $request.region -or $null -eq $request.region.x -or $null -eq $request.region.y -or $null -eq $request.region.width -or $null -eq $request.region.height -or $null -eq $request.maxWidth) { throw 'REQUEST_INVALID' }
        if ([double]$request.maxWidth -ne [double][int]$request.maxWidth) { throw 'REQUEST_INVALID' }
        $result = [HexthonRoiCapture]::Capture([string]$request.hwnd, [double]$request.region.x, [double]$request.region.y, [double]$request.region.width, [double]$request.region.height, [int]$request.maxWidth)
        $header = @{id=$requestId;ok=$true;byteLength=$result.Bytes.Length;hwnd=[string]$request.hwnd;pid=$result.Pid;
            width=$result.Width;height=$result.Height;dpi=$result.Dpi;capturedAt=[DateTime]::UtcNow.ToString('o');durationMs=$result.DurationMs;
            clientRect=@{x=$result.ClientX;y=$result.ClientY;width=$result.ClientWidth;height=$result.ClientHeight};
            pixelRegion=@{x=$result.PixelX;y=$result.PixelY;width=$result.PixelWidth;height=$result.PixelHeight};
            region=@{x=([double]$result.PixelX/$result.ClientWidth);y=([double]$result.PixelY/$result.ClientHeight);width=([double]$result.PixelWidth/$result.ClientWidth);height=([double]$result.PixelHeight/$result.ClientHeight)}}
        Write-Reply $header $result.Bytes
    } catch {
        $cause = $_.Exception
        while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
        $code = 'CAPTURE_FAILED'
        if ($cause.Message -in @('WINDOW_UNAVAILABLE','NOT_LEAGUE','NOT_FOREGROUND','NOT_VISIBLE','MINIMIZED','WINDOW_CHANGED','OFFSCREEN','DPI_UNAVAILABLE','CAPTURE_LIMIT','REQUEST_INVALID')) { $code = $cause.Message }
        try { Write-Reply @{id=$requestId;ok=$false;error=$code;byteLength=0} ([byte[]]::new(0)) } catch { break }
    }
}
