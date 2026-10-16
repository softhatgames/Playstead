using System.ComponentModel;
using System.Reflection;
using Microsoft.Xna.Framework.Graphics;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using D3DTexture2D = SharpDX.Direct3D11.Texture2D;
using Resource = SharpDX.Direct3D11.Resource;
using Texture = Microsoft.Xna.Framework.Graphics.Texture;

namespace PreviewProbe;

/// <summary>
/// A ring of shared Direct3D 11 textures the game copies finished frames into
/// on the GPU, so the preview can show them without reading pixels back. Each
/// has an NT handle, which only works in the process holding it, so the game
/// duplicates the handles into the desktop shell's main process once the
/// shell has named it. A slot is reused only after the shell says it has
/// released it.
/// </summary>
sealed class SharedTextures
{
    readonly DeviceContext context;
    readonly Resource source;
    readonly D3DTexture2D[] textures;
    readonly IntPtr[] handles;
    readonly Query finished;
    // The handles' values in the shell's process, once duplicated there.
    uint[]? remote;
    int sharedWith;
    // 0 free, 1 with the preview.
    readonly int[] busy;
    int next;

    SharedTextures(DeviceContext context, Resource source, D3DTexture2D[] textures, IntPtr[] handles, Query finished)
    {
        this.context = context;
        this.source = source;
        this.textures = textures;
        this.handles = handles;
        this.finished = finished;
        busy = new int[textures.Length];
    }

    /// <summary>Creates the ring for copies of <paramref name="target"/>; call on the game's thread.</summary>
    public static SharedTextures Create(GraphicsDevice graphics, RenderTarget2D target, int count = 3)
    {
        var device = (SharpDX.Direct3D11.Device)graphics.Handle;
        // MonoGame keeps the render target's Direct3D texture internal.
        var getTexture = typeof(Texture).GetMethod("GetTexture", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingMethodException("MonoGame's Texture.GetTexture is gone.");
        var source = (Resource)getTexture.Invoke(target, null)!;
        Texture2DDescription description;
        using (var texture = source.QueryInterface<D3DTexture2D>())
            description = texture.Description;
        // The shell imports them as rgba.
        if (description.Format != Format.R8G8B8A8_UNorm)
            throw new NotSupportedException($"The render target is {description.Format}, not R8G8B8A8_UNorm.");
        description.MipLevels = 1;
        description.ArraySize = 1;
        description.SampleDescription = new SampleDescription(1, 0);
        description.Usage = ResourceUsage.Default;
        description.BindFlags = BindFlags.RenderTarget | BindFlags.ShaderResource;
        description.CpuAccessFlags = CpuAccessFlags.None;
        description.OptionFlags = ResourceOptionFlags.Shared | ResourceOptionFlags.SharedNthandle;
        var textures = new D3DTexture2D[count];
        var handles = new IntPtr[count];
        for (var i = 0; i < count; i++)
        {
            textures[i] = new D3DTexture2D(device, description);
            using var shared = textures[i].QueryInterface<Resource1>();
            handles[i] = shared.CreateSharedHandle((string?)null, SharedResourceFlags.Read | SharedResourceFlags.Write, null);
        }
        var finished = new Query(device, new QueryDescription { Type = QueryType.Event });
        return new SharedTextures(device.ImmediateContext, source, textures, handles, finished);
    }

    /// <summary>The Direct3D feature level MonoGame's device runs at, such as 11.0.</summary>
    public static string FeatureLevel(GraphicsDevice graphics) =>
        ((SharpDX.Direct3D11.Device)graphics.Handle).FeatureLevel.ToString().Replace("Level_", "").Replace('_', '.');

    /// <summary>Duplicates the handles into the shell's process, unless they are there already.</summary>
    public void ShareWith(int shellProcess)
    {
        if (sharedWith == shellProcess)
            return;
        var process = Win32.OpenProcess(Win32.ProcessDupHandle, false, shellProcess);
        if (process == IntPtr.Zero)
            throw new Win32Exception();
        try
        {
            var values = new uint[handles.Length];
            for (var i = 0; i < handles.Length; i++)
            {
                if (!Win32.DuplicateHandle(Win32.GetCurrentProcess(), handles[i], process, out var copy, 0, false, Win32.DuplicateSameAccess))
                    throw new Win32Exception();
                // Handles are 32-bit values, even in 64-bit processes.
                values[i] = (uint)copy;
            }
            remote = values;
            sharedWith = shellProcess;
        }
        finally
        {
            Win32.CloseHandle(process);
        }
    }

    /// <summary>A free slot, marked busy, or -1 when the preview still has them all or has none yet.</summary>
    public int Acquire()
    {
        if (remote is null)
            return -1;
        for (var tried = 0; tried < textures.Length; tried++)
        {
            var slot = (next + tried) % textures.Length;
            if (Interlocked.CompareExchange(ref busy[slot], 1, 0) == 0)
            {
                next = (slot + 1) % textures.Length;
                return slot;
            }
        }
        return -1;
    }

    /// <summary>The shell has released the slot's texture. Safe from any thread.</summary>
    public void Release(int slot)
    {
        if (slot >= 0 && slot < busy.Length)
            Volatile.Write(ref busy[slot], 0);
    }

    /// <summary>The slot's handle in the shell's process.</summary>
    public uint Id(int slot) => remote![slot];

    /// <summary>
    /// Copies the render target, the game's finished frame, into the slot's
    /// texture and waits for the GPU, so the texture is complete before the
    /// preview is told about it.
    /// </summary>
    public void CopyFrame(int slot)
    {
        context.CopyResource(source, textures[slot]);
        context.End(finished);
        context.Flush();
        while (!context.IsDataAvailable(finished))
            Thread.SpinWait(64);
    }
}
