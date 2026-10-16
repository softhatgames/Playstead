using System.Buffers.Binary;
using System.Runtime.InteropServices;
using Microsoft.Xna.Framework;

namespace PreviewProbe;

/// <summary>
/// The SDL 2 calls the probe needs, from the library MonoGame's DesktopGL has
/// already loaded: hiding the window, and pushing key events so the preview's
/// keys reach MonoGame's own <c>Keyboard.GetState()</c>.
/// </summary>
static unsafe class Sdl
{
    const uint KeyDown = 0x300;
    const uint KeyUp = 0x301;
    const int EventSize = 56;

    static readonly delegate* unmanaged<IntPtr, void> hideWindow;
    static readonly delegate* unmanaged<IntPtr, uint> getWindowId;
    static readonly delegate* unmanaged<byte*, int> pushEvent;

    static Sdl()
    {
        string[] names = OperatingSystem.IsWindows() ? ["SDL2.dll", "SDL2"]
            : OperatingSystem.IsMacOS() ? ["libSDL2-2.0.0.dylib", "libSDL2.dylib", "SDL2"]
            : ["libSDL2-2.0.so.0", "SDL2"];
        foreach (var name in names)
        {
            if (!NativeLibrary.TryLoad(name, typeof(Game).Assembly, null, out var library))
                continue;
            if (NativeLibrary.TryGetExport(library, "SDL_HideWindow", out var hide))
                hideWindow = (delegate* unmanaged<IntPtr, void>)hide;
            if (NativeLibrary.TryGetExport(library, "SDL_GetWindowID", out var id))
                getWindowId = (delegate* unmanaged<IntPtr, uint>)id;
            if (NativeLibrary.TryGetExport(library, "SDL_PushEvent", out var push))
                pushEvent = (delegate* unmanaged<byte*, int>)push;
            return;
        }
    }

    public static bool HideWindow(IntPtr window)
    {
        if (hideWindow == null)
            return false;
        hideWindow(window);
        return true;
    }

    public static bool CanPushKeys => pushEvent != null && getWindowId != null;

    /// <summary>Queues a key event for MonoGame's next event poll. Safe from any thread.</summary>
    public static bool PushKey(IntPtr window, string code, bool down)
    {
        if (!CanPushKeys || KeyCodes(code) is not { } codes)
            return false;
        var (scancode, keycode) = codes;
        var buffer = stackalloc byte[EventSize];
        var e = new Span<byte>(buffer, EventSize);
        e.Clear();
        BinaryPrimitives.WriteUInt32LittleEndian(e, down ? KeyDown : KeyUp);
        BinaryPrimitives.WriteUInt32LittleEndian(e[8..], getWindowId(window));
        e[12] = down ? (byte)1 : (byte)0;
        BinaryPrimitives.WriteInt32LittleEndian(e[16..], scancode);
        BinaryPrimitives.WriteInt32LittleEndian(e[20..], keycode);
        return pushEvent(buffer) == 1;
    }

    /// <summary>SDL's scancode and keycode for a DOM key code.</summary>
    static (int, int)? KeyCodes(string code)
    {
        const int scancodeMask = 1 << 30;
        switch (code)
        {
            case "ArrowRight": return (79, 79 | scancodeMask);
            case "ArrowLeft": return (80, 80 | scancodeMask);
            case "ArrowDown": return (81, 81 | scancodeMask);
            case "ArrowUp": return (82, 82 | scancodeMask);
            case "Space": return (44, ' ');
            case "Enter": return (40, '\r');
        }
        if (code.Length == 4 && code.StartsWith("Key") && code[3] is >= 'A' and <= 'Z')
            return (4 + code[3] - 'A', char.ToLowerInvariant(code[3]));
        if (code.Length == 6 && code.StartsWith("Digit") && code[5] is >= '0' and <= '9')
            return (code[5] == '0' ? 39 : 29 + code[5] - '0', code[5]);
        return null;
    }
}
