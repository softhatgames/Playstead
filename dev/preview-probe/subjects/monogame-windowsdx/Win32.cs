using System.Runtime.InteropServices;

namespace PreviewProbe;

/// <summary>The Windows calls the WindowsDX subject needs: hiding its window and sharing handles with the shell.</summary>
static class Win32
{
    public const int Hide = 0;
    public const uint ProcessDupHandle = 0x0040;
    public const uint DuplicateSameAccess = 0x0002;

    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);

    /// <summary>
    /// Asks for a 1 ms timer, as SDL does for DesktopGL. Since Windows 10
    /// version 2004 each process keeps the default of about 15.6 ms unless it
    /// asks, and MonoGame's WindowsDX sleeps between frames by it, so frames
    /// come unevenly. Windows 11 may ignore the request while the process's
    /// windows are hidden, as the game's is in a preview run, unless the
    /// process opts out.
    /// </summary>
    public static void UseFineTimer()
    {
        var state = new PowerThrottlingState { Version = 1, ControlMask = IgnoreTimerResolution, StateMask = 0 };
        SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, ref state, Marshal.SizeOf<PowerThrottlingState>());
        timeBeginPeriod(1);
    }

    const int ProcessPowerThrottling = 4;
    const uint IgnoreTimerResolution = 0x4;

    [StructLayout(LayoutKind.Sequential)]
    struct PowerThrottlingState
    {
        public uint Version;
        public uint ControlMask;
        public uint StateMask;
    }

    [DllImport("kernel32.dll")]
    static extern bool SetProcessInformation(IntPtr process, int informationClass, ref PowerThrottlingState information, int size);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
}
