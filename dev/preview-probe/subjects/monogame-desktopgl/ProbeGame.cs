using System.Buffers.Binary;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Audio;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;
#if WINDOWSDX
using SharedFrames = PreviewProbe.SharedTextures;
#else
using SharedFrames = PreviewProbe.SharedSurfaces;
#endif

namespace PreviewProbe;

/// <summary>
/// A small game for the preview probe: a square moved with the arrow keys or
/// a click, a beep on Space, a spinning bar and a panel whose colour shows the
/// reload marker. In the preview it draws off-screen and sends every frame.
/// The monogame-windowsdx subject builds this file with WINDOWSDX defined.
/// </summary>
sealed class ProbeGame : Game
{
    const int Width = 1280;
    const int Height = 720;
    const int Block = 8;
    // MonoGame's GetData returns rows top to bottom.
    const bool RowsBottomUp = false;
#if WINDOWSDX
    const string Library = "MonoGame.Framework.WindowsDX";
    const string GraphicsApi = "Direct3D 11";
    const string SharedRoute = "d3d11";
#else
    const string Library = "MonoGame.Framework.DesktopGL";
    const string GraphicsApi = "OpenGL";
    const string SharedRoute = "iosurface";
#endif

    static readonly Color[] PanelColours =
    [
        new(90, 90, 90), new(52, 152, 219), new(46, 204, 113), new(241, 196, 15),
        new(155, 89, 182), new(231, 76, 60), new(26, 188, 156), new(230, 126, 34),
    ];

    readonly string? previewAddress;
    readonly string frames;
    readonly bool showWindow;
    SharedFrames? surfaces;
    // Keys from the preview, for when SDL events cannot carry them.
    readonly HashSet<Keys> injectedKeys = [];
    PreviewConnection? connection;
    IntPtr window;
    bool keysThroughSdl;
    RenderTarget2D target = null!;
    SpriteBatch batch = null!;
    Texture2D white = null!;
    SoundEffect? beep;
    string? audioError;
    bool windowHidden;
#if WINDOWSDX
    bool keepHidden;
#endif

    Vector2 square = new(Width / 2f, Height / 2f);
    bool spaceWasDown;
    bool mouseWasDown;
    float spin;
    uint frame;
    uint inputSeq;
    double inputReceived;
    double updateTime;

    public ProbeGame(string? previewAddress, string frames, bool showWindow)
    {
        this.previewAddress = previewAddress;
        this.frames = frames;
        this.showWindow = showWindow;
        _ = new GraphicsDeviceManager(this)
        {
            PreferredBackBufferWidth = Width,
            PreferredBackBufferHeight = Height,
            // A hidden preview window must not wait for the display.
            SynchronizeWithVerticalRetrace = previewAddress is null,
#if WINDOWSDX
            // Reach creates a Direct3D feature level 9_3 device, which cannot
            // share textures through NT handles.
            GraphicsProfile = GraphicsProfile.HiDef,
#endif
        };
        IsFixedTimeStep = true;
        TargetElapsedTime = TimeSpan.FromTicks(TimeSpan.TicksPerSecond / 60);
#if WINDOWSDX
        Win32.UseFineTimer();
#endif
        // MonoGame sleeps 20 ms a frame while its window is inactive, and the
        // preview's window never is.
        InactiveSleepTime = TimeSpan.Zero;
        IsMouseVisible = true;
        Window.Title = previewAddress is null ? "Preview probe: Play" : "Preview probe: preview";
    }

    protected override void Initialize()
    {
        if (previewAddress is not null)
        {
            window = Window.Handle;
            keysThroughSdl = Sdl.CanPushKeys;
            // Keys from the preview become SDL events as they arrive, as a
            // keyboard's would, so the game's own Keyboard.GetState() sees them.
            connection = PreviewConnection.Open(previewAddress, Width * Height * 4, input =>
            {
                if (keysThroughSdl && input.Kind == "key" && input.Code is { } code)
                    Sdl.PushKey(window, code, input.Down);
            });
            ReloadNotifier.Applied += types => connection.SendJson(new
            {
                type = "reloaded",
                time = Clock.Now(),
                types = types?.Select(t => t.FullName).ToArray() ?? [],
            });
            if (!showWindow)
                windowHidden = HideWindow();
        }
        base.Initialize();
    }

    /// <summary>
    /// Hides the game's window. WinForms shows MonoGame's WindowsDX form
    /// when the game loop starts, after the first update, so there it moves
    /// off the screen first, and each update hides it again if it is showing.
    /// </summary>
    bool HideWindow()
    {
#if WINDOWSDX
        Window.Position = new Point(-32000, -32000);
        keepHidden = true;
        return true;
#else
        return Sdl.HideWindow(window);
#endif
    }

    protected override void LoadContent()
    {
        batch = new SpriteBatch(GraphicsDevice);
        white = new Texture2D(GraphicsDevice, 1, 1);
        white.SetData([Color.White]);
        target = new RenderTarget2D(GraphicsDevice, Width, Height, false, SurfaceFormat.Color, DepthFormat.None);
        try
        {
            beep = MakeBeep();
        }
        catch (Exception e)
        {
            audioError = $"{e.GetType().Name}: {e.Message}";
        }
        string? framesError = null;
        if (connection is not null && frames != "raw")
        {
            try
            {
                if (frames != SharedRoute)
                    throw new NotSupportedException($"{Library} shares frames as {SharedRoute}, not {frames}.");
#if WINDOWSDX
                surfaces = SharedTextures.Create(GraphicsDevice, target);
#else
                if (!OperatingSystem.IsMacOS())
                    throw new PlatformNotSupportedException("IOSurface frames need macOS.");
                surfaces = SharedSurfaces.Create(Width, Height);
#endif
                connection.SurfaceReleased = surfaces.Release;
            }
            catch (Exception e)
            {
                framesError = $"{e.GetType().Name}: {e.Message}";
            }
        }
        var library = typeof(Game).Assembly;
        connection?.SendJson(new
        {
            type = "hello",
            protocol = 1,
            pid = Environment.ProcessId,
            width = Width,
            height = Height,
            runtime = RuntimeInformation.FrameworkDescription,
            os = RuntimeInformation.OSDescription,
            arch = RuntimeInformation.ProcessArchitecture.ToString(),
            library = Library + " "
                + (library.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                    ?? library.GetName().Version?.ToString()),
            graphics = GraphicsAdapter.DefaultAdapter.Description,
#if WINDOWSDX
            graphicsApi = $"{GraphicsApi}, feature level {SharedTextures.FeatureLevel(GraphicsDevice)}",
#else
            graphicsApi = GraphicsApi,
#endif
#if DEBUG
            build = "Debug",
#else
            build = "Release",
#endif
            windowHidden,
            frames = surfaces is not null ? frames : "raw",
            framesError,
            keyInput = keysThroughSdl ? "SDL events read by Keyboard.GetState()" : "the game's own input layer",
            mouseInput = "the game's own input layer",
            audio = new { ok = audioError is null, error = audioError },
        });
        PlayBeep();
    }

    protected override void Update(GameTime gameTime)
    {
        updateTime = Clock.Now();
#if WINDOWSDX
        if (keepHidden && Win32.IsWindowVisible(window))
            Win32.ShowWindow(window, Win32.Hide);
#endif
        if (connection is { Closed: true })
        {
            Exit();
            return;
        }
        var keyboard = Keyboard.GetState();
        if (connection is not null)
            TakeInputs(keyboard);

        bool Down(Keys key) => keyboard.IsKeyDown(key) || injectedKeys.Contains(key);
        if (connection is null && Down(Keys.Escape))
            Exit();

        var seconds = (float)gameTime.ElapsedGameTime.TotalSeconds;
        var step = 400f * seconds;
        if (Down(Keys.Left)) square.X -= step;
        if (Down(Keys.Right)) square.X += step;
        if (Down(Keys.Up)) square.Y -= step;
        if (Down(Keys.Down)) square.Y += step;
        square = Vector2.Clamp(square, new Vector2(30), new Vector2(Width - 30, Height - 30));

        var space = Down(Keys.Space);
        if (space && !spaceWasDown)
            PlayBeep();
        spaceWasDown = space;

        var mouse = Mouse.GetState();
        var mouseDown = mouse.LeftButton == ButtonState.Pressed;
        if (connection is null && mouseDown && !mouseWasDown)
            square = mouse.Position.ToVector2();
        mouseWasDown = mouseDown;

        spin += seconds * 2f;
        base.Update(gameTime);
    }

    /// <summary>
    /// Records which of the preview's inputs this update handles. A key sent as
    /// an SDL event counts once the keyboard state shows it; a quick press and
    /// release can both land in one poll, so one waiting longer than two frames
    /// counts anyway. Clicks move the square directly: MonoGame reads the
    /// mouse from the system, not from events.
    /// </summary>
    void TakeInputs(KeyboardState keyboard)
    {
        var now = Clock.Now();
        while (connection!.Inputs.TryPeek(out var input))
        {
            if (input.Kind == "key" && KeyFor(input.Code) is { } key)
            {
                if (keysThroughSdl)
                {
                    if (keyboard.IsKeyDown(key) != input.Down && now - input.Received < 2 * TargetElapsedTime.TotalMilliseconds)
                        break;
                }
                else if (input.Down)
                    injectedKeys.Add(key);
                else
                    injectedKeys.Remove(key);
            }
            else if (input.Kind == "mouse" && input.Down)
            {
                square = new Vector2(input.X, input.Y);
            }
            connection.Inputs.TryDequeue(out _);
            inputSeq = input.Seq;
            inputReceived = input.Received;
        }
    }

    static Keys? KeyFor(string? code) => code switch
    {
        "ArrowLeft" => Keys.Left,
        "ArrowRight" => Keys.Right,
        "ArrowUp" => Keys.Up,
        "ArrowDown" => Keys.Down,
        "Space" => Keys.Space,
        "Enter" => Keys.Enter,
        { Length: 4 } when code.StartsWith("Key") && Enum.TryParse<Keys>(code[3..], out var letter) => letter,
        { Length: 6 } when code.StartsWith("Digit") => Keys.D0 + (code[5] - '0'),
        _ => null,
    };

    protected override void Draw(GameTime gameTime)
    {
        var marker = ReloadMarker.Value();
        GraphicsDevice.SetRenderTarget(target);
        GraphicsDevice.Clear(new Color(24, 26, 32));
        batch.Begin(samplerState: SamplerState.PointClamp);
        DrawScene(marker);
        batch.End();
        var rendered = Clock.Now();
        if (connection is not null && surfaces is not null)
        {
#if WINDOWSDX
            // The textures go to the shell once it has said which process it is.
            if (connection.ShellProcess is { } shell)
                surfaces.ShareWith(shell);
#endif
            // While the render target is still bound: copy it on the GPU.
            var slot = surfaces.Acquire();
            if (slot >= 0)
            {
                surfaces.CopyFrame(slot);
                connection.SendSurfaceFrame(new FrameInfo(
                    frame, Width, Height, inputSeq, marker, 0,
                    updateTime, rendered, Clock.Now(), inputReceived), surfaces.Id(slot), slot);
            }
        }
        GraphicsDevice.SetRenderTarget(null);

        if (connection is not null && surfaces is null)
        {
            var pixels = connection.RentBuffer();
            target.GetData(pixels);
            connection.Submit(pixels, new FrameInfo(
                frame, Width, Height, inputSeq, marker, RowsBottomUp ? 1u : 0u,
                updateTime, rendered, Clock.Now(), inputReceived));
        }

        GraphicsDevice.Clear(Color.Black);
        batch.Begin();
        batch.Draw(target, Vector2.Zero, Color.White);
        batch.End();
        frame++;
        base.Draw(gameTime);
    }

    void DrawScene(int marker)
    {
        var grid = new Color(40, 44, 54);
        for (var x = 0; x < Width; x += 80)
            Fill(new Rectangle(x, 0, 1, Height), grid);
        for (var y = 0; y < Height; y += 80)
            Fill(new Rectangle(0, y, Width, 1), grid);

        // The reload marker: a panel whose colour changes with each reload
        // edit, with one square per unit of its value.
        Fill(new Rectangle(Width - 360, 40, 320, 180), PanelColours[Math.Abs(marker) % PanelColours.Length]);
        for (var i = 0; i < Math.Min(marker, 12); i++)
            Fill(new Rectangle(Width - 350 + i * 26, 232, 20, 20), Color.White);

        batch.Draw(white, new Vector2(Width / 2f, Height - 160), null, new Color(120, 200, 255),
            spin, new Vector2(0.5f), new Vector2(320, 10), SpriteEffects.None, 0);
        Fill(new Rectangle((int)(frame * 4 % Width), Height - 12, 40, 12), new Color(255, 255, 255, 180));
        Fill(new Rectangle((int)square.X - 30, (int)square.Y - 30, 60, 60), new Color(255, 140, 40));

        // Machine-readable rows the viewer checks against the frame header:
        // the input sequence, the reload marker and the frame number.
        DrawBits(0, inputSeq);
        DrawBits(1, (uint)marker);
        DrawBits(2, frame);
    }

    void DrawBits(int row, uint value)
    {
        for (var bit = 0; bit < 32; bit++)
            Fill(new Rectangle(bit * Block, row * Block, Block, Block),
                (value >> bit & 1) == 1 ? Color.White : Color.Black);
    }

    void Fill(Rectangle area, Color colour) => batch.Draw(white, area, colour);

    void PlayBeep()
    {
        string? error = audioError;
        if (beep is not null)
        {
            try
            {
                if (!beep.Play())
                    error = "SoundEffect.Play returned false";
            }
            catch (Exception e)
            {
                error = $"{e.GetType().Name}: {e.Message}";
            }
        }
        connection?.SendJson(new { type = "audio", time = Clock.Now(), ok = error is null, error });
    }

    static SoundEffect MakeBeep()
    {
        const int rate = 44100;
        const int samples = rate / 8;
        var data = new byte[samples * 2];
        for (var i = 0; i < samples; i++)
        {
            var fade = 1f - (float)i / samples;
            var value = (short)(Math.Sin(2 * Math.PI * 660 * i / rate) * 9000 * fade);
            BinaryPrimitives.WriteInt16LittleEndian(data.AsSpan(i * 2), value);
        }
        return new SoundEffect(data, rate, AudioChannels.Mono);
    }

    protected override void UnloadContent()
    {
        connection?.Dispose();
        base.UnloadContent();
    }
}
