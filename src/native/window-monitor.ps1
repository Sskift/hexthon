param([int]$IntervalMs = 60, [int]$ParentProcessId = 0)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class HexthonWindowReader {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    public delegate bool EnumProc(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect rect, int size);

    public sealed class Bounds { public int x, y, width, height; }
    public sealed class WindowInfo {
        public string hwnd; public int pid, x, y, width, height;
        public bool visible, minimized, foreground; public Bounds clientRect;
    }
    public sealed class CursorInfo { public int x, y; public bool active, leftDown, leftPressed; public long pressId; }
    public sealed class State { public WindowInfo game, client; public CursorInfo cursor; public string observedAt; }
    static List<IntPtr> games = new List<IntPtr>(), clients = new List<IntPtr>();
    static long nextDiscovery = 0, pressId = 0; static bool previousDown = false;

    public static void Initialize() {
        // Only changes DPI interpretation for this hidden helper thread.
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
    }
    static void Discover() {
        games.Clear(); clients.Clear();
        var kinds = new Dictionary<uint, bool>();
        foreach (var p in Process.GetProcesses()) {
            try {
                var name = p.ProcessName;
                if (String.Equals(name, "League of Legends", StringComparison.OrdinalIgnoreCase)) kinds[(uint)p.Id] = true;
                else if (String.Equals(name, "LeagueClientUx", StringComparison.OrdinalIgnoreCase) || String.Equals(name, "LeagueClient", StringComparison.OrdinalIgnoreCase)) kinds[(uint)p.Id] = false;
            } catch { } finally { p.Dispose(); }
        }
        EnumWindows((hwnd, parameter) => {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            bool game;
            if (kinds.TryGetValue(pid, out game)) { if (game) games.Add(hwnd); else clients.Add(hwnd); }
            return true;
        }, IntPtr.Zero);
    }
    static WindowInfo ReadWindow(IntPtr hwnd, IntPtr foreground, uint foregroundPid) {
        if (!IsWindow(hwnd)) return null;
        Rect rect;
        if (!GetWindowRect(hwnd, out rect)) return null;
        Rect visible;
        try { if (DwmGetWindowAttribute(hwnd, 9, out visible, Marshal.SizeOf(typeof(Rect))) == 0) rect = visible; } catch { }
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        Rect client; Point origin = new Point(); Bounds content = null;
        if (GetClientRect(hwnd, out client) && ClientToScreen(hwnd, ref origin)) content = new Bounds { x=origin.X, y=origin.Y, width=client.Right-client.Left, height=client.Bottom-client.Top };
        return new WindowInfo { hwnd=hwnd.ToInt64().ToString(), pid=(int)pid, x=rect.Left, y=rect.Top,
            width=Math.Max(0,rect.Right-rect.Left), height=Math.Max(0,rect.Bottom-rect.Top),
            visible=IsWindowVisible(hwnd), minimized=IsIconic(hwnd), foreground=(hwnd==foreground || pid==foregroundPid), clientRect=content };
    }
    static WindowInfo Best(List<IntPtr> windows, IntPtr foreground, uint foregroundPid) {
        WindowInfo best = null; long bestScore = -1;
        foreach (var hwnd in windows) {
            var w = ReadWindow(hwnd,foreground,foregroundPid); if (w==null || w.width<200 || w.height<150) continue;
            long score=(long)w.width*w.height+(w.visible?1000000000L:0)+(w.foreground?2000000000L:0);
            if (score>bestScore) { best=w; bestScore=score; }
        }
        return best;
    }
    public static State Read() {
        long now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (now>=nextDiscovery) { Discover(); nextDiscovery=now+1500; }
        IntPtr foreground=GetForegroundWindow(); uint foregroundPid; GetWindowThreadProcessId(foreground,out foregroundPid);
        var game=Best(games,foreground,foregroundPid); var client=Best(clients,foreground,foregroundPid);
        var cursor=new CursorInfo { pressId=pressId };
        if (game!=null && game.foreground && game.visible && !game.minimized) {
            Point point;
            if (GetCursorPos(out point)) { cursor.x=point.X; cursor.y=point.Y; cursor.active=true; }
            int button=GetSystemMetrics(23)!=0?2:1;
            cursor.leftDown=GetAsyncKeyState(button)<0;
            cursor.leftPressed=cursor.leftDown&&!previousDown;
            if (cursor.leftPressed) cursor.pressId=++pressId;
        }
        previousDown=cursor.leftDown;
        return new State { game=game, client=client, cursor=cursor, observedAt=DateTime.UtcNow.ToString("o") };
    }
}
'@
[HexthonWindowReader]::Initialize()
$nextParentCheck = [DateTime]::UtcNow
while ($true) {
    if ($ParentProcessId -gt 0 -and [DateTime]::UtcNow -ge $nextParentCheck) {
        if (-not (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue)) { break }
        $nextParentCheck = [DateTime]::UtcNow.AddSeconds(5)
    }
    [HexthonWindowReader]::Read() | ConvertTo-Json -Compress -Depth 5
    Start-Sleep -Milliseconds $IntervalMs
}
