using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Net.Sockets;
using System.Text.Json;

namespace PreviewProbe;

/// <summary>Wall-clock milliseconds since the Unix epoch, the clock every probe process shares.</summary>
static class Clock
{
    public static double Now() => (DateTime.UtcNow - DateTime.UnixEpoch).TotalMilliseconds;
}

/// <summary>An input event from the preview, stamped when the game received it.</summary>
sealed record InputMessage(uint Seq, string Kind, string? Code, bool Down, float X, float Y, double Received);

/// <summary>What the frame header says about one frame. Times are <see cref="Clock"/> milliseconds.</summary>
readonly record struct FrameInfo(
    uint Frame,
    uint Width,
    uint Height,
    uint InputSeq,
    int Marker,
    uint Flags,
    double Update,
    double Rendered,
    double Readback,
    double InputReceived);

/// <summary>
/// The probe's test connection to the preview: frames out, input in, over a
/// Unix socket or, on Windows, a named pipe. The protocol is in the probe's
/// README. The game never waits for the preview: a frame that is not sent
/// before the next one is ready is replaced.
/// </summary>
sealed class PreviewConnection : IDisposable
{
    public const int HeaderSize = 80;
    const byte JsonMessage = 1;
    const byte FrameMessage = 2;
    const byte SurfaceFrameMessage = 3;
    const string PipePrefix = @"\\.\pipe\";

    readonly Stream stream;
    readonly int frameBytes;
    readonly Action<InputMessage> onInput;
    readonly object writeLock = new();
    readonly object frameLock = new();
    readonly Stack<byte[]> free = new();
    byte[]? pending;
    FrameInfo pendingInfo;
    volatile bool closed;
    volatile int shellProcess;

    public ConcurrentQueue<InputMessage> Inputs { get; } = new();

    /// <summary>True once the preview has gone; the game should exit.</summary>
    public bool Closed => closed;

    /// <summary>Called on the receiving thread when the preview releases a shared surface's slot.</summary>
    public Action<int>? SurfaceReleased { get; set; }

    /// <summary>
    /// The desktop shell's main process once the preview has named it, or
    /// null. Shared textures on Windows are duplicated into it.
    /// </summary>
    public int? ShellProcess => shellProcess == 0 ? null : shellProcess;

    PreviewConnection(Stream stream, int frameBytes, Action<InputMessage> onInput)
    {
        this.stream = stream;
        this.frameBytes = frameBytes;
        this.onInput = onInput;
        new Thread(SendFrames) { IsBackground = true, Name = "Preview frames" }.Start();
        new Thread(ReceiveMessages) { IsBackground = true, Name = "Preview input" }.Start();
    }

    /// <summary>Connects to the preview. <paramref name="onInput"/> runs on the receiving thread as each input arrives, before it is queued.</summary>
    public static PreviewConnection Open(string address, int frameBytes, Action<InputMessage> onInput)
    {
        if (address.StartsWith(PipePrefix, StringComparison.Ordinal))
        {
            // Asynchronous, or Windows serialises the receiving thread's
            // waiting read with every write, and nothing is ever sent.
            var pipe = new NamedPipeClientStream(".", address[PipePrefix.Length..], PipeDirection.InOut, PipeOptions.Asynchronous);
            pipe.Connect(10_000);
            return new PreviewConnection(pipe, frameBytes, onInput);
        }
        var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        socket.Connect(new UnixDomainSocketEndPoint(address));
        return new PreviewConnection(new NetworkStream(socket, ownsSocket: true), frameBytes, onInput);
    }

    public void SendJson(object message)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(message);
        var prefix = new byte[5];
        BinaryPrimitives.WriteUInt32LittleEndian(prefix, (uint)(json.Length + 1));
        prefix[4] = JsonMessage;
        Write(prefix, json);
    }

    /// <summary>A buffer for the next frame's pixels, returned to the pool once sent.</summary>
    public byte[] RentBuffer()
    {
        lock (frameLock)
            return free.Count > 0 ? free.Pop() : new byte[frameBytes];
    }

    /// <summary>Queues a frame, replacing one still waiting to be sent.</summary>
    public void Submit(byte[] pixels, FrameInfo info)
    {
        lock (frameLock)
        {
            if (pending is not null)
                free.Push(pending);
            pending = pixels;
            pendingInfo = info;
            Monitor.Pulse(frameLock);
        }
    }

    void SendFrames()
    {
        var header = new byte[5 + HeaderSize];
        while (true)
        {
            byte[] pixels;
            FrameInfo info;
            lock (frameLock)
            {
                while (pending is null && !closed)
                    Monitor.Wait(frameLock);
                if (closed)
                    return;
                pixels = pending!;
                info = pendingInfo;
                pending = null;
            }
            WriteHeader(header, info, pixels.Length);
            Write(header, pixels);
            lock (frameLock)
                free.Push(pixels);
        }
    }

    /// <summary>
    /// Announces a frame the game has finished copying into a shared surface:
    /// the header, then the surface's ID and slot instead of pixels.
    /// </summary>
    public void SendSurfaceFrame(FrameInfo info, uint surfaceId, int slot)
    {
        var message = new byte[5 + HeaderSize + 8];
        WriteHeader(message, info, 8, SurfaceFrameMessage);
        BinaryPrimitives.WriteUInt32LittleEndian(message.AsSpan(5 + HeaderSize), surfaceId);
        BinaryPrimitives.WriteInt32LittleEndian(message.AsSpan(5 + HeaderSize + 4), slot);
        Write(message, []);
    }

    static void WriteHeader(Span<byte> header, FrameInfo info, int payloadBytes, byte type = FrameMessage)
    {
        BinaryPrimitives.WriteUInt32LittleEndian(header, (uint)(1 + HeaderSize + payloadBytes));
        header[4] = type;
        var h = header[5..];
        BinaryPrimitives.WriteUInt32LittleEndian(h[0..], info.Frame);
        BinaryPrimitives.WriteUInt32LittleEndian(h[4..], info.Width);
        BinaryPrimitives.WriteUInt32LittleEndian(h[8..], info.Height);
        BinaryPrimitives.WriteUInt32LittleEndian(h[12..], info.InputSeq);
        BinaryPrimitives.WriteInt32LittleEndian(h[16..], info.Marker);
        BinaryPrimitives.WriteUInt32LittleEndian(h[20..], info.Flags);
        BinaryPrimitives.WriteDoubleLittleEndian(h[24..], info.Update);
        BinaryPrimitives.WriteDoubleLittleEndian(h[32..], info.Rendered);
        BinaryPrimitives.WriteDoubleLittleEndian(h[40..], info.Readback);
        BinaryPrimitives.WriteDoubleLittleEndian(h[48..], Clock.Now());
        BinaryPrimitives.WriteDoubleLittleEndian(h[56..], info.InputReceived);
        // 64..79 are the relay's to fill.
        h[64..].Clear();
    }

    void Write(byte[] first, byte[] second)
    {
        if (closed)
            return;
        try
        {
            lock (writeLock)
            {
                stream.Write(first);
                stream.Write(second);
            }
        }
        catch (Exception e) when (e is IOException or ObjectDisposedException)
        {
            Close();
        }
    }

    void ReceiveMessages()
    {
        var prefix = new byte[5];
        try
        {
            while (!closed)
            {
                stream.ReadExactly(prefix);
                var length = (int)BinaryPrimitives.ReadUInt32LittleEndian(prefix) - 1;
                var payload = new byte[length];
                stream.ReadExactly(payload);
                var received = Clock.Now();
                if (prefix[4] != JsonMessage)
                    continue;
                if (ReadNumber(payload, "clock", "id") is { } id)
                    SendJson(new { type = "clock", id, time = received });
                else if (ReadNumber(payload, "released", "slot") is { } slot)
                    SurfaceReleased?.Invoke(slot);
                else if (ReadNumber(payload, "shell", "pid") is { } pid)
                    shellProcess = pid;
                else if (ReadInput(payload, received) is { } input)
                {
                    onInput(input);
                    Inputs.Enqueue(input);
                }
            }
        }
        catch (Exception e) when (e is IOException or EndOfStreamException or ObjectDisposedException)
        {
            Close();
        }
    }

    /// <summary>
    /// A number from a JSON message of the given type: a clock request's id,
    /// a released slot or the shell's process. Null for any other message.
    /// </summary>
    static int? ReadNumber(byte[] payload, string type, string property)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;
            return root.GetProperty("type").GetString() == type ? root.GetProperty(property).GetInt32() : null;
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }

    /// <summary>An input message, or null for any other or malformed message.</summary>
    static InputMessage? ReadInput(byte[] payload, double received)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;
            if (root.GetProperty("type").GetString() != "input")
                return null;
            return new InputMessage(
                root.GetProperty("seq").GetUInt32(),
                root.GetProperty("kind").GetString() ?? "",
                root.TryGetProperty("code", out var code) ? code.GetString() : null,
                root.TryGetProperty("down", out var down) && down.GetBoolean(),
                root.TryGetProperty("x", out var x) ? x.GetSingle() : 0,
                root.TryGetProperty("y", out var y) ? y.GetSingle() : 0,
                received);
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }

    void Close()
    {
        lock (frameLock)
        {
            closed = true;
            Monitor.PulseAll(frameLock);
        }
    }

    public void Dispose()
    {
        Close();
        stream.Dispose();
    }
}
