using System.Runtime.InteropServices;

namespace PreviewProbe;

/// <summary>
/// A ring of macOS IOSurfaces the game copies finished frames into on the GPU,
/// so the preview can show them without reading pixels back. Each surface is
/// global, so the desktop shell can look it up by its ID; a slot is reused only
/// after the shell says it has released it.
/// </summary>
sealed class SharedSurfaces
{
    const string CoreFoundation = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
    const string IOSurface = "/System/Library/Frameworks/IOSurface.framework/IOSurface";
    const string OpenGL = "/System/Library/Frameworks/OpenGL.framework/OpenGL";

    const uint TextureRectangle = 0x84F5;
    const uint Rgba = 0x1908;
    const uint Bgra = 0x80E1;
    const uint UnsignedInt8888Rev = 0x8367;
    const uint ReadFramebuffer = 0x8CA8;
    const uint DrawFramebuffer = 0x8CA9;
    const uint ReadFramebufferBinding = 0x8CAA;
    const uint DrawFramebufferBinding = 0x8CA6;
    const uint TextureBindingRectangle = 0x84F6;
    const uint ColorAttachment0 = 0x8CE0;
    const uint FramebufferComplete = 0x8CD5;
    const uint ColorBufferBit = 0x4000;
    const uint Nearest = 0x2600;

    readonly int width;
    readonly int height;
    readonly uint[] ids;
    readonly uint[] framebuffers;
    // 0 free, 1 with the preview.
    readonly int[] busy;
    int next;

    public int Count => ids.Length;

    SharedSurfaces(int width, int height, uint[] ids, uint[] framebuffers)
    {
        this.width = width;
        this.height = height;
        this.ids = ids;
        this.framebuffers = framebuffers;
        busy = new int[ids.Length];
    }

    /// <summary>Creates the ring in the current OpenGL context; call on the game's thread.</summary>
    public static SharedSurfaces Create(int width, int height, int count = 3)
    {
        var context = CGLGetCurrentContext();
        if (context == IntPtr.Zero)
            throw new InvalidOperationException("No current OpenGL context.");
        glGetIntegerv(TextureBindingRectangle, out var boundTexture);
        glGetIntegerv(DrawFramebufferBinding, out var boundDraw);
        var ids = new uint[count];
        var framebuffers = new uint[count];
        for (var i = 0; i < count; i++)
        {
            var surface = CreateSurface(width, height);
            ids[i] = IOSurfaceGetID(surface);
            glGenTextures(1, out var texture);
            glBindTexture(TextureRectangle, texture);
            var error = CGLTexImageIOSurface2D(context, TextureRectangle, Rgba, width, height, Bgra, UnsignedInt8888Rev, surface, 0);
            if (error != 0)
                throw new InvalidOperationException($"CGLTexImageIOSurface2D failed: {error}");
            glGenFramebuffers(1, out framebuffers[i]);
            glBindFramebuffer(DrawFramebuffer, framebuffers[i]);
            glFramebufferTexture2D(DrawFramebuffer, ColorAttachment0, TextureRectangle, texture, 0);
            var status = glCheckFramebufferStatus(DrawFramebuffer);
            if (status != FramebufferComplete)
                throw new InvalidOperationException($"Surface framebuffer incomplete: 0x{status:X}");
        }
        glBindTexture(TextureRectangle, (uint)boundTexture);
        glBindFramebuffer(DrawFramebuffer, (uint)boundDraw);
        return new SharedSurfaces(width, height, ids, framebuffers);
    }

    /// <summary>A free slot, marked busy, or -1 when the preview still has them all.</summary>
    public int Acquire()
    {
        for (var tried = 0; tried < ids.Length; tried++)
        {
            var slot = (next + tried) % ids.Length;
            if (Interlocked.CompareExchange(ref busy[slot], 1, 0) == 0)
            {
                next = (slot + 1) % ids.Length;
                return slot;
            }
        }
        return -1;
    }

    /// <summary>The shell has released the slot's surface. Safe from any thread.</summary>
    public void Release(int slot)
    {
        if (slot >= 0 && slot < busy.Length)
            Volatile.Write(ref busy[slot], 0);
    }

    public uint Id(int slot) => ids[slot];

    /// <summary>
    /// Copies the framebuffer bound for drawing, the game's finished frame, into
    /// the slot's surface and waits for the GPU, so the surface is complete
    /// before the preview is told about it.
    /// </summary>
    public void CopyFrame(int slot)
    {
        glGetIntegerv(DrawFramebufferBinding, out var source);
        glGetIntegerv(ReadFramebufferBinding, out var read);
        glBindFramebuffer(ReadFramebuffer, (uint)source);
        glBindFramebuffer(DrawFramebuffer, framebuffers[slot]);
        glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, ColorBufferBit, Nearest);
        glBindFramebuffer(ReadFramebuffer, (uint)read);
        glBindFramebuffer(DrawFramebuffer, (uint)source);
        glFinish();
    }

    static IntPtr CreateSurface(int width, int height)
    {
        var cf = NativeLibrary.Load(CoreFoundation);
        var iosurface = NativeLibrary.Load(IOSurface);
        IntPtr Constant(IntPtr library, string name) => Marshal.ReadIntPtr(NativeLibrary.GetExport(library, name));
        var properties = CFDictionaryCreateMutable(IntPtr.Zero, 0,
            NativeLibrary.GetExport(cf, "kCFTypeDictionaryKeyCallBacks"),
            NativeLibrary.GetExport(cf, "kCFTypeDictionaryValueCallBacks"));
        void SetNumber(string key, int value)
        {
            var number = CFNumberCreate(IntPtr.Zero, 3 /* kCFNumberSInt32Type */, ref value);
            CFDictionarySetValue(properties, Constant(iosurface, key), number);
            CFRelease(number);
        }
        SetNumber("kIOSurfaceWidth", width);
        SetNumber("kIOSurfaceHeight", height);
        SetNumber("kIOSurfaceBytesPerElement", 4);
        SetNumber("kIOSurfacePixelFormat", 0x42475241 /* 'BGRA' */);
        // Deprecated as insecure, but the only way another process can find a
        // surface without a Mach channel; enough for the probe.
        CFDictionarySetValue(properties, Constant(iosurface, "kIOSurfaceIsGlobal"), Constant(cf, "kCFBooleanTrue"));
        var surface = IOSurfaceCreate(properties);
        CFRelease(properties);
        if (surface == IntPtr.Zero)
            throw new InvalidOperationException("IOSurfaceCreate failed.");
        return surface;
    }

    [DllImport(CoreFoundation)] static extern IntPtr CFDictionaryCreateMutable(IntPtr allocator, nint capacity, IntPtr keyCallBacks, IntPtr valueCallBacks);
    [DllImport(CoreFoundation)] static extern IntPtr CFNumberCreate(IntPtr allocator, nint type, ref int value);
    [DllImport(CoreFoundation)] static extern void CFDictionarySetValue(IntPtr dictionary, IntPtr key, IntPtr value);
    [DllImport(CoreFoundation)] static extern void CFRelease(IntPtr value);
    [DllImport(IOSurface)] static extern IntPtr IOSurfaceCreate(IntPtr properties);
    [DllImport(IOSurface)] static extern uint IOSurfaceGetID(IntPtr surface);
    [DllImport(OpenGL)] static extern IntPtr CGLGetCurrentContext();
    [DllImport(OpenGL)] static extern int CGLTexImageIOSurface2D(IntPtr context, uint target, uint internalFormat, int width, int height, uint format, uint type, IntPtr surface, uint plane);
    [DllImport(OpenGL)] static extern void glGenTextures(int count, out uint texture);
    [DllImport(OpenGL)] static extern void glBindTexture(uint target, uint texture);
    [DllImport(OpenGL)] static extern void glGenFramebuffers(int count, out uint framebuffer);
    [DllImport(OpenGL)] static extern void glBindFramebuffer(uint target, uint framebuffer);
    [DllImport(OpenGL)] static extern void glFramebufferTexture2D(uint target, uint attachment, uint textureTarget, uint texture, int level);
    [DllImport(OpenGL)] static extern uint glCheckFramebufferStatus(uint target);
    [DllImport(OpenGL)] static extern void glGetIntegerv(uint name, out int value);
    [DllImport(OpenGL)] static extern void glBlitFramebuffer(int sx0, int sy0, int sx1, int sy1, int dx0, int dy0, int dx1, int dy1, uint mask, uint filter);
    [DllImport(OpenGL)] static extern void glFinish();
}
