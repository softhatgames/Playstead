# Preview frame transport

- **Question:** What is the fastest way to get a native game's frames into Playstead's preview, within Playstead's architecture, on macOS and Windows?
- **Date:** 2026-10-16. All sources were accessed on this date.
- **Outcome (a recommendation; the founder decides):** keep raw frames through the host as the path every client can use, and add three ways to send frames to the [preview probe](../../dev/preview-probe/README.md), measured as now. First, cheaper raw frames: asynchronous readback, and the page receiving and drawing in a worker. That may bring the Windows laptop to 60 frames per second on its own. Second, the fastest route: the game shares its GPU texture and Electron's experimental `sharedTexture` module puts it in the page with no CPU copy, on macOS and then Windows. It serves only the desktop shell and needs Playstead's first native module. Third, hardware H.264 with WebCodecs, the route a browser or phone preview needs. Games run unsandboxed for now ([decision 0022][adr-0022]), so no route is blocked today.
- **Versions:** Electron 44.7.1 (Chromium 152.0.7977.149), Codex 0.162.1, MonoGame 3.8.6, .NET 10, macOS 26.6.2 on an Apple M3 Max.
- **Local evidence:** the installed Electron 44.7.1 typings (`electron.d.ts`); Electron's source at tag `v44.7.1` and Codex's at `rust-v0.162.1`; the macOS 26 SDK headers; the probe's recorded runs; and two small command-line programs run on the founder's Mac, unsandboxed, inside `codex sandbox` with the `:workspace` profile, and under variants of a Seatbelt profile. None opened a window. They are marked **Observed**.

Labels: **Documented** (official documentation, specifications, headers, source or release notes), **Observed** (the probe's runs or the local checks above), **Inference** (reasoning, not a source) and **Unconfirmed** (not established).

## Summary

- **Where the time goes (Observed).** From the game finishing a frame to the page drawing it took 15.0 ms on the Mac and 25.6 ms on the Windows laptop, which showed 51 of 60 frames with its preview window hidden by mistake ([game stacks](game-stacks.md#preview-probe-runs)). Reading back and moving the 3.7 MB frame took 7.7 ms and 16.7 ms, summing the stages' medians; most of the rest was the page waiting for its next display refresh ([Mac run][run-mac], [Windows run][run-win]).
- **Fastest: share the GPU texture (Documented; its delay is Inference).** Since Electron 40, Electron's main process can import an IOSurface (macOS) or a Direct3D 11 NT handle (Windows) and send it to a sandboxed, context-isolated page as a `VideoFrame`. No CPU copy; a few small messages per frame. It serves only the desktop shell, the API is experimental, and Node cannot receive another process's IOSurface or handle, so the shell needs a native module. The game must draw into a shareable texture; MonoGame DesktopGL can on macOS, but on Windows only through an OpenGL–Direct3D extension whose support on Intel graphics is Unconfirmed.
- **For a browser or a phone: hardware video (Documented; its delay is Unconfirmed).** The game encodes H.264 on the GPU from its texture and the page decodes it with WebCodecs: about 25–42 KB a frame instead of 3.7 MB. No vendor publishes encode delay at 720p. Chromium's decoder holds frames back unless the stream says it has no reordering. It is lossy, and a phone needs HTTPS.
- **No shared CPU memory reaches the page (Documented).** Node, Electron and the sandboxed renderer have no way to map memory another process wrote. It could shorten only the game-to-host leg, through a native module.
- **Measured on the Mac (Observed).** The shared-texture route works with MonoGame DesktopGL and Electron 44.7.1: moving a frame took 2.9 ms against 7.3 ms for raw frames, summing the stages' medians before the wait for refresh, with 60 frames per second shown, none dropped and every checked frame matching its marker blocks ([shared run][run-mac-iosurface], [raw run][run-mac-raw]).
- **Headless rendering under a sandbox (Observed).** Under Codex's macOS profile no GPU route can work: no Metal device, no OpenGL pixel format and no IOSurface, because the profile allows IOKit only for `RootDomainUserClient`. Under an otherwise open Seatbelt profile, allowing just two IOKit user clients was enough for headless Metal and OpenGL rendering with the window server and every Mach service denied, though Metal then could not compile shaders. MonoGame DesktopGL still needs the window server, because SDL creates its OpenGL context from a window.

## The current path

The probe's game draws into a render target, reads it back with `GetData`, and sends an 80-byte header and the raw RGBA pixels to a Node relay standing in for the host, which forwards them over a WebSocket to the page; the page uploads them with `texSubImage2D` on the next animation frame. Milliseconds, median (95th percentile):

| Stage                     | Mac, 120 Hz | Windows laptop, 60 Hz |
| ------------------------- | ----------- | --------------------- |
| Readback                  | 2.3 (2.9)   | 5.3 (6.6)             |
| Unix socket or named pipe | 3.3 (4.5)   | 3.5 (4.9)             |
| Relay                     | 0.4 (0.4)   | 1.0 (3.3)             |
| WebSocket to the page     | 1.7 (2.0)   | 6.9 (19.3)            |
| Wait to draw              | 6.3 (8.6)   | 7.0 (14.6)            |
| Frame delay               | 15.0 (16.2) | 25.6 (37.7)           |

- **Copies (Inference, from the probe's code and the sources in section 4).** `GetData` copies the pixels into managed memory. The socket or pipe copies them into the kernel and out again, in 8 KB steps on macOS and 64 KB on Windows. The relay joins the pieces into one buffer. The WebSocket copies them into the kernel and out again in Chromium's network service, which passes them to the page through a 131,000-byte pipe. Blink joins the pieces and copies them into an `ArrayBuffer`, and `texSubImage2D` copies them to the GPU process and the GPU. About ten copies of 3.7 MB: over 2 GB/s at 60 frames per second.
- **Uneven delivery (Inference).** No document explains it. In Chromium's source each frame needs about 29 refills of that pipe, each a task on the page's main thread, so other work on that thread delays frames ([websocket.cc][cr-ws-pipe], [channel][cr-ws-channel]).

## 1. Sharing the GPU texture

### Electron's `sharedTexture`

- **Status (Documented).** Electron 40.0.0 (2026-01-16) "Added support to import external shared texture as VideoFrame" ([v40.0.0][e40]). Every method is experimental and "could be removed in the future" ([docs][st-docs]). Electron 44 fixed a crash when the GPU context is unavailable ([v44.0.0][e44]). Electron's test runs only on macOS arm64: "Tests only run properly on macOS arm64 for now" ([spec][st-spec]).
- **Flow (Documented).** `importSharedTexture`, main process only, takes a handle, size and pixel format (`bgra`, `rgba`, `rgbaf16`, `nv12`, `nv16` or `p010le`) and creates a Chromium shared image from it in the GPU process. `sendSharedTexture` passes it to a frame with a request and reply that times out after 1000 ms. The renderer's `setSharedTextureReceiver` callback gets an object whose `getVideoFrame()` wraps the shared image as a `VideoFrame` without a copy ([docs][st-docs], [main side][st-browser], [implementation][st-cc]). WebGPU's `importExternalTexture` and WebGL's `texImage2D` both take a `VideoFrame` ([WebGPU][webgpu], [WebGL][webgl]).
- **Sandboxed renderer (Documented).** At v44.7.1 `sharedTexture` is in a sandboxed preload's module list, though the sandbox tutorial's list omits it ([module list][sandboxed-modules], [tutorial][sandbox-doc]). `contextBridge` passes a `VideoFrame` to the page by reference ([contextBridge][context-bridge], [source][cb-cc]). Electron's own test does this with default `webPreferences`, which have had the sandbox on since Electron 20 ([preload][st-preload], [tutorial][sandbox-doc]).
- **Handles (Documented).** The handle must already be valid in the importing process: an `IOSurfaceRef` on macOS, or on Windows an NT handle from `CreateSharedHandle`, which Electron duplicates. A legacy shared handle would crash Chromium when closed ([handle][st-handle], [design note][st-readme], [implementation][st-cc]).
- **Lifetime (Documented).** Chromium's sync tokens order GPU work between Electron's processes; `release()` and `allReferencesReleased` tell the owner when every process is done ([design note][st-readme]). Nothing orders it against the game's GPU work: Electron imports a surface without a fence. Per `CGLIOSurface.h`, another context sees a surface's new contents only after the writer flushes. So the game must finish its drawing before announcing a frame, and must not draw into that texture again until Electron releases it (Inference).

### Getting the handle to Electron's main process

- **A native module (Documented, Inference).** Node has no API to receive a Mach port or duplicate a Windows handle. Electron's design note says another process's texture needs `DuplicateHandle` on Windows, and on macOS a Mach port sent "through a previously created IPC" or a deprecated global surface ([design note][st-readme]). Its offscreen rendering docs say the same of its own shared textures: "This is an advanced feature requiring a native node module" ([offscreen rendering][osr]). The desktop shell would gain a small native module in its main process, Playstead's first native code.
- **macOS (Documented, Observed).** A global IOSurface can be looked up by its 32-bit ID. `kIOSurfaceIsGlobal` has been deprecated since macOS 10.11 because "Global surfaces are insecure", but Syphon still uses it ([Apple][iosurface-global], [Syphon][syphon]). Observed on macOS 26.6.2: `IOSurfaceLookup` in one process found a global surface created in another and read its pixels, also when the creator ran under a Seatbelt profile denying every Mach look-up; a surface created without the flag was not found. The ID fits the game's existing socket. Any local process that guesses an ID can read the frames (Inference). The secure way is `IOSurfaceCreateMachPort`, sent over a Mach channel: the shell registers a bootstrap name and the game looks it up, as Chromium's rendezvous server does ([Apple][iosurface-port], [Chromium][cr-rendezvous]). In C# that means calling `mach_msg` through P/Invoke.
- **Windows (Documented).** The game creates the texture with `D3D11_RESOURCE_MISC_SHARED_NTHANDLE` and calls `CreateSharedHandle`, optionally with a name and a security descriptor ([CreateSharedHandle][dxgi-create]). The shell's module then either duplicates the handle out of the game's process, which needs `PROCESS_DUP_HANDLE` on it ([DuplicateHandle][duplicatehandle]), or opens the name with `ID3D12Device::OpenSharedHandleByName`, which returns an NT handle in the shell's own process ([OpenSharedHandleByName][open-by-name]). The game must never get `PROCESS_DUP_HANDLE` on Electron's process: Microsoft warns that right yields full access to it ([process rights][process-rights]).
- **Fit (Inference).** The host keeps the game connection, input and control. The page asks the shell, through its preload, to attach a game's textures, and the shell's module imports them. Per frame only a texture number and the frame header travel, and they can go through the host as now. Two variants: import and send every frame, as Electron's tests do; or import a ring of three textures once and call `getVideoFrame()` each frame. Whether a reused import shows new contents is Unconfirmed.

### In the game

- **macOS, OpenGL (Documented).** `CGLTexImageIOSurface2D` binds an IOSurface to a rectangle texture, and "the binding is 'live'" (SDK header `CGLIOSurface.h`). OpenGL has been deprecated since macOS 10.14 but is still present ([Mojave notes][mojave]). MonoGame keeps its GL texture names and bindings internal, and its public `RenderTarget2D.FromNativeHandle` wraps only 2D textures on OpenGL ([Texture.OpenGL.cs][mg-texture], [RenderTarget2D.cs][mg-rt2d]). Workable (Inference): after the game draws its render target, the library takes MonoGame's context with `CGLGetCurrentContext`, blits into its own IOSurface-backed framebuffer with its own GL bindings, finishes, and restores MonoGame's state.
- **macOS, Metal or Vulkan (Documented).** Metal's `newTextureWithDescriptor:iosurface:plane:` and MoltenVK's `VK_EXT_metal_objects`, since MoltenVK 1.1.11, use an IOSurface as a texture ([Metal][metal-device], [MoltenVK][moltenvk]). MonoGame's Vulkan backend is a preview and enables none of these extensions ([README][mg-readme], [Vulkan device][mg-vk]).
- **Windows, OpenGL (Documented; support Unconfirmed).** `WGL_NV_DX_interop2` lets OpenGL draw into a Direct3D 11 texture; lock and unlock are the synchronisation points ([spec][wgl-interop2]). The only vendor statement is NVIDIA's own spec. Spout tests the extension at run time and falls back to the CPU ([Spout][spout-gl]). Support on the Intel laptop is Unconfirmed. ANGLE accepts only legacy share handles and would mean OpenGL ES ([ANGLE][angle-share]).
- **Windows, Direct3D 11 (Documented).** MonoGame's WindowsDX platform draws with Direct3D 11. A shared NT-handle texture needs Direct3D 11.1; a keyed mutex is optional ([flags][d3d11-misc]). Inference: a game would then build DesktopGL on macOS and WindowsDX on Windows, which is a stack decision. The founder accepted Direct3D on Windows on 2026-10-16 ([decision 0023](https://github.com/softhatgames/playstead-v0/blob/research/preview-probe/docs/adr/0023-direct3d-on-windows.md)).
- **Connection library (Inference).** IOSurface and CGL calls, or Direct3D 11 and WGL interop calls, through P/Invoke; a ring of textures; a finish before announcing each frame; and raw frames as the fallback. The shell's module is Playstead's, not the game's, so games stay independent of Playstead's language.

### Expected delay (Inference)

A GPU copy into the shared texture (or none, if the game draws there), a finish, and three or four small messages between processes. Likely 1–3 ms from the game finishing a frame to the page drawing it, before the wait for refresh. Electron's per-frame cost is Unconfirmed until measured.

### Other GPU sharing

- **Electron's offscreen rendering** shares textures the other way: Electron renders a page and hands the app a texture ([offscreen rendering][osr]). It is useful only as a test source, as in Electron's tests.
- **Syphon and Spout (Documented)** show the pattern works between unrelated apps. Syphon sends a global IOSurface ID over `CFMessagePort`; Spout writes a legacy Direct3D 11 share handle into named shared memory ([Syphon][syphon], [Spout][spout]). Electron cannot import Spout's legacy handles.

## 2. Shared CPU memory

- **Nothing reaches the page (Documented).** Node 24 has no memory-mapping API, and `worker_threads` share memory only within a process ([worker_threads][node-worker]). A `SharedArrayBuffer` cannot be deserialised in another agent cluster ([HTML][html-structured]). Electron 44.7.1's typings expose no shared memory, and a sandboxed renderer cannot load a native module.
- **What it would save (Inference).** Through a native module in the host or the shell, the socket or pipe leg (3.3–3.5 ms) and the relay's join. If the shell's module copied the pixels into its own IOSurface or Direct3D 11 texture for `sharedTexture`, the WebSocket and the WebGL upload would go too, leaving the readback and one CPU copy. It is a fallback for a game that cannot share textures, such as OpenGL on Windows without the interop.
- **Sandbox (Observed, Documented).** Inside Codex's `:workspace` profile on macOS a file-backed mapping in the writable folder worked and `shm_open` was denied; the profile allows POSIX shared memory only for OpenMP's names ([profile][codex-sb-base]). .NET's named maps work only on Windows; elsewhere a file-backed map is the portable choice ([MemoryMappedFile][dotnet-mmf]).

## 3. Hardware video encoding

- **In the game, macOS (Documented).** VideoToolbox's low-latency rate control (macOS 11.3) enforces "Infinite GOP (all P frames following the beginning IDR)" and "No frame reordering"; Apple's header gives settings for "cloud gaming (cases where every millisecond counts)" ([Apple][vt-low-latency], [WWDC21][wwdc21]). It can encode from an IOSurface-backed pixel buffer, though the SDK header `VTCompressionSession.h` warns that buffers it did not allocate may be copied, and converted when their format differs from the encoder's.
- **In the game, Windows (Documented).** Media Foundation's H.264 encoder takes YUV such as NV12, not RGB; a Direct3D 11 texture goes in through `MFCreateDXGISurfaceBuffer`, and the Video Processor MFT converts BGRA to NV12 on the GPU ([surface buffer][mf-dxgi], [video processor][mf-vp]). `CODECAPI_AVLowLatencyMode` asks for one output per input, but low-latency mode is optional for hardware certification ([low latency][mf-lowlatency], [H.264 encoder][mf-h264]). Chromium's own encoder does this ([Chromium][cr-mf-enc]). Intel's Meteor Lake media engine encodes H.264, HEVC and AV1 ([Intel][intel-media]); whether its Windows encoder honours low latency is Unconfirmed.
- **In the page (Documented).** WebCodecs' `VideoDecoder` has `optimizeForLatency` ([WebCodecs][webcodecs]). Chromium decodes H.264 with VideoToolbox on macOS and Direct3D on Windows, and passes the hint on ([decoder][cr-decoder]). Electron is built with the proprietary codecs ([build arguments][electron-args]). The decoded `VideoFrame` is drawn like a shared texture.
- **The decode trap (Documented in source).** Chromium's H.264 decoder releases a frame at once only when the stream's sequence parameters set `max_num_reorder_frames` to 0; otherwise it holds frames up to the decoded picture buffer's size ([h264_decoder.cc][h264-decoder]). The encoder must write that flag. Which encoders do by default is Unconfirmed.
- **Bytes (Inference).** 12–20 Mbps for 720p60 without B-frames, so 25–42 KB a frame, with larger keyframes. YouTube recommends 8 Mbps for live 720p60 ([YouTube][youtube]).
- **Delay (Unconfirmed).** No vendor publishes encode delay at 720p; NVIDIA publishes only throughput ([NVENC][nvenc-note]). Parsec claims 4–8 ms for its whole LAN pipeline at 240 frames per second, a vendor claim ([Parsec][parsec]).
- **Quality (Inference).** Hardware H.264 stores colour at half resolution, which blurs coloured edges in pixel art and small text. That may suit a preview judged for feel, and Play stays exact.
- **Browser and phone (Documented).** The same stream serves any client. `VideoDecoder` needs a secure context: `127.0.0.1` is one, but a phone on the network needs HTTPS ([WebCodecs][webcodecs], [secure contexts][secure-contexts]). Safari on iPhone has had `VideoDecoder` since 16.4; 26.4 fixed out-of-order H.264 output ([16.4][safari-164], [26.4][safari-264]).
- **Connection library (Inference).** Per system: the texture hand-off, colour conversion, encoder set-up, keyframes on request and parameter sets, through P/Invoke to VideoToolbox or COM to Media Foundation; Microsoft's .NET VideoToolbox binding needs the macOS workload ([.NET][dotnet-vt]). It is the heaviest library of all the routes. A Playstead helper could encode instead, fed by route 1's shared texture, keeping the game's part to the hand-off.
- **Sandbox (Documented).** VideoToolbox encodes in an XPC service, which Chromium's GPU sandbox allows as `com.apple.coremedia.videoencoder` ([gpu.sb][cr-gpu-sb]). Codex's profile does not.
- **JPEG (Inference).** About 100–200 KB a frame, four to six times H.264's bitrate; `createImageBitmap` decodes it off the main thread. Simpler, but no faster.

## 4. Faster hops on the current path

- **Readback (Documented).** MonoGame 3.8.6's `GetData` on DesktopGL blocks: it runs on the UI thread and calls `glGetTexImage` into managed memory ([Texture2D.OpenGL.cs][mg-texture-gl]). Reading into a pixel buffer object returns at once and lets the copy "proceed in parallel" (OpenGL 2.1), and fences (OpenGL 3.2) say when it is done ([PBO][arb-pbo], [sync][arb-sync]). MonoGame exposes neither, so the library would make its own GL calls (Inference). Mapping the buffer a frame later adds a frame of delay; waiting on a fence later in the same frame does not (Inference). It frees up to 2.3 ms (Mac) or 5.3 ms (Windows) of the game's frame, but saves less of the delay.
- **Socket and pipe (Documented; gain Inference).** macOS Unix sockets default to 8 KB of buffer, about 450 hand-offs a frame ([XNU][xnu-uipc]); the game can raise its send buffer. libuv creates Windows pipes with 64 KB buffers and reads 64 KB at a time ([libuv][libuv-win-pipe]). Reading into a preallocated buffer with `onread` would avoid the relay's join ([net][node-net]). The gain is unmeasured.
- **Page (Documented; effect Unconfirmed).** A WebSocket and an `OffscreenCanvas` both work in a dedicated worker, which keeps frames off the interface's main thread ([WebSockets][ws-standard], [OffscreenCanvas][offscreen-canvas]). `WebSocketStream`, with back-pressure, is stable in Chromium 152 ([status][wsstream]). Drawing each frame as it arrives, rather than at the next animation frame, with the `desynchronized` hint the viewer already sets, might shorten the wait to draw, the largest stage ([desynchronized][desynchronized]).
- **Skipping the host (Documented).** Electron's main process could open the game's socket itself, but must not do heavy work ([performance][electron-perf]). Every way from main to a page copies: `webContents.postMessage` transfers only ports, so an `ArrayBuffer` is cloned ([webContents][wc-postmessage]). Electron 44.7.1 sends large `webContents.send` values in shared memory the renderer parses in place, but `MessagePort` paths still copy ([commit][ipc-perf]), and a preload copies an `ArrayBuffer` again through `contextBridge` ([contextBridge][context-bridge]). It saves no copies and moves the game connection out of the host.
- **Custom protocol (Documented).** `protocol.handle` can stream a body into `fetch()`, but with no declared length Electron 44.7.1 uses a 64 KB pipe, so a frame arrives in about 57 slices, each waking Electron's main thread and the page ([loader][stream-loader], [commit][ipc-perf]). No better.
- **WebTransport (Documented).** Chromium supports it, with self-signed certificates pinned by hash and valid for at most two weeks ([WebTransport][webtransport]). Node 24 has no WebTransport server: `node:quic` is in early development and lacks WebTransport's framing ([quic][node-quic]). Over loopback it would not help (Inference).

## 5. Embedding the game's window

[Decision 0015][adr-0015] rejected it as fragile on every system, and it cannot serve a browser or phone. Under Codex's sandboxes it cannot work at all: on macOS the game cannot reach the window server (Observed), and on Windows the elevated sandbox runs commands on a private desktop the person never sees ([desktop.rs][codex-desktop], [runner][codex-runner]), so the window could not be shown (Inference). Not pursued.

## Rendering without a window under a sandbox

Observed on the founder's Mac with Codex 0.162.1. A small program created a Metal device and ran a render pass, created an IOSurface, and created an accelerated OpenGL context, cleared a framebuffer, read a pixel back and drew into an IOSurface through `CGLTexImageIOSurface2D`. It had no window and no `NSApplication`. A second program compiled a shader in each API.

| Profile                                                                                                              | Metal device and render | IOSurface | OpenGL context  |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------- | --------------- |
| None                                                                                                                 | Works                   | Works     | Works           |
| `codex sandbox`, `:workspace`                                                                                        | No device               | Fails     | No pixel format |
| Everything allowed but the window server                                                                             | Works                   | Works     | Works           |
| Everything allowed but Mach look-ups                                                                                 | Works                   | Works     | Works           |
| Everything allowed but IOKit                                                                                         | No device               | Fails     | No pixel format |
| Everything allowed but Mach look-ups and IOKit, except IOKit for `AGXDeviceUserClient` and `IOSurfaceRootUserClient` | Works                   | Works     | Works           |

- **Shaders.** In the last profile OpenGL compiled and linked a shader; Metal could not compile one from source: "Unable to reach MTLCompilerService … Sandbox restriction". Allowing only `AGXDeviceUserClient` crashed Metal.
- **Codex's profile.** It allows IOKit only for `RootDomainUserClient`, and its source has no setting to add more ([profile][codex-sb-base], [seatbelt.rs][codex-seatbelt-rs]). Its denial log named the window server, `tccd` and the OpenGL compiler service, but not the IOKit refusals that stopped the GPU. Inside it `shm_open` and bootstrap look-ups were denied, and a file-backed mapping worked.
- **What headless rendering needs.** Not the window server: the GPU's IOKit user client, `IOSurfaceRootUserClient`, and `MTLCompilerService` for Metal shaders. Chromium's GPU sandbox allows these, plus the window server and the video encoder, and covers every GPU vendor with the `IOAccelerator` connection ([gpu.sb][cr-gpu-sb]). The two class names above are Apple silicon's.
- **MonoGame DesktopGL cannot use it.** It always creates an SDL window, and SDL's offscreen driver needs EGL, which macOS lacks ([SDLGameWindow.cs][mg-sdl-window], [SDL][sdl-offscreen]). A DesktopGL game under a sandbox needs the window server as well. A Metal or Vulkan backend could do without it (Inference).
- **Windows (Documented in source; nothing run).** Codex's elevated sandbox starts commands with `CreateProcessWithLogonW` as `CodexSandboxOffline`, on a private desktop `Winsta0\CodexSandboxDesktop-…`, with a write-restricted token whose restricting SIDs include the logon SID and Everyone ([desktop.rs][codex-desktop], [token.rs][codex-token], [runner][codex-runner]). A game window there is invisible, so Play could not run sandboxed (Inference). Objects the game creates get a default DACL granting the logon SID, which Codex's comment says the sandbox account shares with the person; so the person's processes can probably duplicate the game's handles (Inference, Unconfirmed). A pipe Node creates lets other users only read unless the host listens with `writableAll` ([pipe security][pipe-security], [net][node-net], [libuv][libuv-pipe]). Loopback TCP is blocked for the offline user ([Codex note][codex-note]).

## Comparison

Delay is from the game finishing a frame to the page drawing it, before the wait for refresh. "Sandbox" is what a game sandbox would also have to allow, for later isolation.

| Route                 | Per frame                                   | Delay                                                        | Serves                           | Needs                                                                                                                                                                                           | Sandbox                                                          |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Raw frames, now       | About ten CPU copies of 3.7 MB              | 7.7 ms Mac, 16.7 ms Windows (Observed, sum of stage medians) | Every client                     | Nothing new                                                                                                                                                                                     | The GPU and window server (macOS); a pipe it can write (Windows) |
| 1. Shared GPU texture | No CPU copy; about 100 bytes of messages    | 1–3 ms (Inference)                                           | Desktop shell                    | Electron 40 or later (experimental); on macOS, a native module in the shell; the game drawing into an IOSurface (macOS) or a Direct3D 11 NT-handle texture (Windows), with MonoGame's WindowsDX | IOSurface access; on Windows, handles shared between users       |
| 2. Shared CPU memory  | One or two CPU copies; none through sockets | 3–4 ms less than now (Inference)                             | Desktop shell, or the host       | A native module in the shell or host                                                                                                                                                            | A file-backed map in a writable folder                           |
| 3. Hardware H.264     | No copy of raw pixels; 25–42 KB             | Unconfirmed; a vendor claims 4–8 ms for a whole pipeline     | Every client; a phone over HTTPS | An encoder per system in the library; WebCodecs in the page                                                                                                                                     | VideoToolbox's XPC service (macOS)                               |
| 4. Raw frames, tuned  | The same copies, fewer joins                | Less readback stall; evenness Unconfirmed                    | Every client                     | GL calls in the library; a worker in the page                                                                                                                                                   | As now                                                           |
| 5. Embedded window    | None                                        | As Play                                                      | Desktop shell                    | Re-parenting a window, differently per system                                                                                                                                                   | Impossible under Codex's sandboxes                               |

## Prototypes to add to the probe

Each is a new way to send frames, chosen by a probe option and recorded with the result, so `pnpm probe:preview compare` shows it beside raw frames.

1. **Raw frames, tuned.** Readback into a pixel buffer object, waited on later in the same frame; a larger socket send buffer; the viewer receiving and drawing in a worker with an `OffscreenCanvas`, as frames arrive. Proves whether the Windows laptop reaches 60 frames per second with even gaps without a new transport, and how much of the wait to draw goes. Days of work, no native code.
2. **Shared texture into Electron, on macOS. Done (Observed, [run][run-mac-iosurface]).** The game blits its render target into a ring of three global IOSurfaces bound with `CGLTexImageIOSurface2D` and calls `glFinish`: 1.2 ms. The relay passes the ID to Electron's main process in 0.4 ms; a Node-API module of about 40 lines, built with `clang`, looks the surface up; importing took 0.2 ms and reaching the page 1.0 ms, at the median. The page copies each `VideoFrame` into its own WebGL texture as it arrives, which also keeps a frozen frame on screen while new frames arrive. Each frame was imported afresh, so whether a reused import shows new contents is still untested. The original plan: The game blits into a ring of three global IOSurfaces and sends their IDs with each frame's header over its socket; the runner gains a native module that looks them up and imports them; the viewer draws each `VideoFrame` with WebGPU and reads the pixel rows as now. Proves the floor on frame delay, Electron's cost per frame, whether a reused import shows new contents, and that it works in a sandboxed renderer.
3. **Shared texture into Electron, on Windows. Done (Observed, [run][run-win-d3d11-timer]).** With Direct3D accepted on Windows, the probe skips `WGL_NV_DX_interop2` and adds a `monogame-windowsdx` subject: the same game on MonoGame's Direct3D 11 version. It copies its render target into a ring of three NT-handle textures and waits for an event query, as `glFinish` does on macOS. The shell names its process, and the game duplicates its handles into it; Electron duplicates a handle again on import, so the game's copies stay valid and no native module is needed ([source][st-cc]). Proves whether the zero-copy route works on the founder's Intel laptop, and its delay there. On the first run the textures could not be created (`E_INVALIDARG`), and the game fell back to raw frames: MonoGame's default Reach profile gave a feature level 9_3 device, and Direct3D checks NT-handle textures against the feature level ([flags][d3d11-misc]). The subject now asks for HiDef; the probe now stops a run whose game falls back. With HiDef, feature level 11.0, the route worked. Against raw frames from the same subject ([raw run][run-win-dx-raw]), the frame delay was 7.4 ms at the median against 18.7 ms, the added delay over Play 18.6 ms at the 95th percentile against 38.0 ms, and every checked frame matched. The game's and the page's clocks agreed within 0.1 ms, but the relay's was up to 8.5 ms off, so the stages through the relay are not comparable. Every frame reached the page, which drew only 48 a second, because the preview window was hidden: Node's `windowsHide` hides a program's first window, and the runner set it for Electron too. The frozen picture also changed, from frame 334 to 355, because the page's copy of a shared frame had not run when the texture went back to the game, which then drew into it again. The page now waits for a fence before releasing each frame. With both fixes ([run][run-win-d3d11-shown]) the frozen frame held and the frame delay stayed at 7.5 ms at the median, against 18.7 ms for raw frames ([raw run][run-win-dx-raw-shown]). The page received all 601 frames but drew 519, because the game made them unevenly: 3.5 to 29.7 ms apart (1st to 99th percentile), where DesktopGL on the same laptop made them 16.62 to 16.68 ms apart. Since Windows 10 version 2004 a process keeps the default timer of about 15.6 ms unless it asks for a finer one ([timeBeginPeriod][timebeginperiod]); SDL asks for 1 ms, and MonoGame's WindowsDX does not but sleeps between frames by the timer. The subject now asks, and opts out of Windows 11 ignoring the request for a hidden window; a game on WindowsDX previewed by Playstead would need the same. With it ([run][run-win-d3d11-timer]) the game made a frame every 16.7 ms at the median and the 95th percentile, and the preview showed 59.6 of 60 frames a second with one gap over two frames. The frame delay was 10.6 ms at the median and 17.8 ms at the 95th percentile, the added delay over Play 19.1 ms at the 95th percentile, every checked frame matched and the frozen frame held. The median rose from 7.5 ms because the frames now arrived at a steady point in the display's refresh, 8.5 ms before the page drew them; where that point falls is chance.
4. **Hardware H.264 with WebCodecs.** VideoToolbox from the IOSurface on macOS, Media Foundation from the Direct3D 11 texture on Windows; the viewer decodes with `optimizeForLatency`. Proves encode and decode delay at 720p60, evenness, bytes per frame, whether Chromium holds frames back, and whether the pixel rows survive compression (they may need larger blocks). It is also the phone's route.

Prototype 1 comes first because it is cheap and aims at the failed frame-rate mark, which a hidden preview window may explain instead. Prototype 2 sets the floor and decides whether an experimental API is worth Playstead's first native code. If the founder wants one route for every client first, prototype 4 can come before 2.

## Open points

- Whether a reused import shows new contents. Whether the experimental API stays; Electron tests it only on macOS arm64.
- Whether drawing each frame as it arrives, instead of on the next display refresh, shortens the 3–6 ms wait that is now most of the Mac's frame delay.
- Whether Electron imports the game's Direct3D 11 textures on the Intel laptop, and how much a second build per platform costs a game.
- Hardware encode and decode delay at 720p60 on both computers, and which encoders write the no-reordering flag.
- Whether drawing frames as they arrive, with `desynchronized`, reaches the display sooner in Electron on macOS and Windows.
- Whether the preview should set the game's pace. A game on its own clock reaches the page at an arbitrary point in the display's refresh: on the Windows laptop its frames waited 8.5 ms at the median to be drawn, and over a longer run its clock drifts against the display's, which loses a frame each time they cross.
- For later isolation ([decision 0022][adr-0022]): whether a game gets a GPU under Codex's Windows sandbox, and whether the person's processes can open its shared handles; and on macOS, a Playstead profile allowing the GPU's IOKit clients, `MTLCompilerService` and, for DesktopGL, the window server.

[adr-0015]: ../adr/0015-browser-rendered-first-game.md
[adr-0022]: ../adr/0022-games-run-unsandboxed-for-now.md
[run-mac]: ../../dev/preview-probe/results/2026-10-15T1641-darwin-arm64-monogame-desktopgl.json
[run-win]: ../../dev/preview-probe/results/2026-10-15T1722-win32-x64-monogame-desktopgl.json
[run-mac-raw]: ../../dev/preview-probe/results/2026-10-16T0551-darwin-arm64-monogame-desktopgl.json
[run-mac-iosurface]: ../../dev/preview-probe/results/2026-10-16T0552-darwin-arm64-monogame-desktopgl.json
[run-win-d3d11]: ../../dev/preview-probe/results/2026-10-16T0636-win32-x64-monogame-windowsdx.json
[run-win-d3d11-hidef]: ../../dev/preview-probe/results/2026-10-16T0707-win32-x64-monogame-windowsdx.json
[run-win-dx-raw]: ../../dev/preview-probe/results/2026-10-16T0709-win32-x64-monogame-windowsdx.json
[run-win-d3d11-shown]: ../../dev/preview-probe/results/2026-10-16T0719-win32-x64-monogame-windowsdx.json
[run-win-dx-raw-shown]: ../../dev/preview-probe/results/2026-10-16T0720-win32-x64-monogame-windowsdx.json
[run-win-d3d11-timer]: ../../dev/preview-probe/results/2026-10-16T0729-win32-x64-monogame-windowsdx.json
[timebeginperiod]: https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod
[codex-note]: codex-app-server.md#what-the-windows-sandbox-enforces
[e40]: https://github.com/electron/electron/releases/tag/v40.0.0
[e44]: https://github.com/electron/electron/releases/tag/v44.0.0
[st-docs]: https://github.com/electron/electron/blob/v44.7.1/docs/api/shared-texture.md
[st-handle]: https://github.com/electron/electron/blob/v44.7.1/docs/api/structures/shared-texture-handle.md
[st-readme]: https://github.com/electron/electron/blob/v44.7.1/shell/common/api/shared_texture/README.md
[st-cc]: https://github.com/electron/electron/blob/v44.7.1/shell/common/api/electron_api_shared_texture.cc
[st-browser]: https://github.com/electron/electron/blob/v44.7.1/lib/browser/api/shared-texture.ts
[st-spec]: https://github.com/electron/electron/blob/v44.7.1/spec/api-shared-texture.spec.ts
[st-preload]: https://github.com/electron/electron/blob/v44.7.1/spec/fixtures/api/shared-texture/managed/preload.js
[sandboxed-modules]: https://github.com/electron/electron/blob/v44.7.1/lib/sandboxed_renderer/api/module-list.ts
[sandbox-doc]: https://github.com/electron/electron/blob/v44.7.1/docs/tutorial/sandbox.md
[context-bridge]: https://github.com/electron/electron/blob/v44.7.1/docs/api/context-bridge.md
[cb-cc]: https://github.com/electron/electron/blob/v44.7.1/shell/renderer/api/electron_api_context_bridge.cc
[osr]: https://github.com/electron/electron/blob/v44.7.1/docs/tutorial/offscreen-rendering.md
[wc-postmessage]: https://github.com/electron/electron/blob/v44.7.1/docs/api/web-contents.md
[electron-perf]: https://github.com/electron/electron/blob/v44.7.1/docs/tutorial/performance.md
[ipc-perf]: https://github.com/electron/electron/commit/25ec66b0ca71a067e9be32bd685180a2b2fb7fce
[stream-loader]: https://github.com/electron/electron/blob/v44.7.1/shell/browser/net/node_stream_loader.cc
[electron-args]: https://github.com/electron/electron/blob/v44.7.1/build/args/all.gn
[codex-sb-base]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/sandboxing/src/seatbelt_base_policy.sbpl
[codex-seatbelt-rs]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/sandboxing/src/seatbelt.rs
[codex-desktop]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/desktop.rs
[codex-token]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/token.rs
[codex-runner]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/bin/command_runner/win.rs
[cr-gpu-sb]: https://chromium.googlesource.com/chromium/src/+/main/sandbox/policy/mac/gpu.sb
[cr-rendezvous]: https://chromium.googlesource.com/chromium/src/+/main/base/apple/mach_port_rendezvous_mac.cc
[cr-ws-pipe]: https://github.com/chromium/chromium/blob/152.0.7977.149/services/network/websocket.cc
[cr-ws-channel]: https://github.com/chromium/chromium/blob/152.0.7977.149/third_party/blink/renderer/modules/websockets/websocket_channel_impl.cc
[cr-decoder]: https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webcodecs/video_decoder.cc
[cr-mf-enc]: https://github.com/chromium/chromium/blob/main/media/gpu/windows/media_foundation_video_encode_accelerator_win.cc
[h264-decoder]: https://github.com/chromium/chromium/blob/main/media/gpu/h264_decoder.cc
[iosurface-global]: https://developer.apple.com/documentation/iosurface/kiosurfaceisglobal
[iosurface-port]: https://developer.apple.com/documentation/iosurface/iosurfacecreatemachport(_:)
[metal-device]: https://developer.apple.com/documentation/metal/mtldevice/1433378-maketexture
[mojave]: https://developer.apple.com/documentation/macos-release-notes/macos-mojave-10_14-release-notes
[syphon]: https://github.com/Syphon/Syphon-Framework/blob/main/SyphonServerBase.m
[spout]: https://github.com/leadedge/Spout2/blob/master/SPOUTSDK/SpoutGL/SpoutDirectX.cpp
[spout-gl]: https://github.com/leadedge/Spout2/blob/master/SPOUTSDK/SpoutGL/SpoutGL.cpp
[moltenvk]: https://github.com/KhronosGroup/MoltenVK/blob/main/Docs/Whats_New.md
[mg-texture]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/Graphics/Texture.OpenGL.cs
[mg-texture-gl]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/Graphics/Texture2D.OpenGL.cs
[mg-rt2d]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Graphics/RenderTarget2D.cs
[mg-readme]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/README.md
[mg-vk]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/native/monogame/vulkan/MGG_Vulkan.cpp
[mg-sdl-window]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/SDL/SDLGameWindow.cs
[sdl-offscreen]: https://github.com/libsdl-org/SDL/blob/SDL2/src/video/offscreen/SDL_offscreenopengles.c
[wgl-interop2]: https://registry.khronos.org/OpenGL/extensions/NV/WGL_NV_DX_interop2.txt
[angle-share]: https://chromium.googlesource.com/angle/angle/+/main/extensions/EGL_ANGLE_d3d_share_handle_client_buffer.txt
[d3d11-misc]: https://learn.microsoft.com/en-us/windows/win32/api/d3d11/ne-d3d11-d3d11_resource_misc_flag
[dxgi-create]: https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgiresource1-createsharedhandle
[duplicatehandle]: https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle
[open-by-name]: https://learn.microsoft.com/en-us/windows/win32/api/d3d12/nf-d3d12-id3d12device-opensharedhandlebyname
[process-rights]: https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights
[pipe-security]: https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights
[node-net]: https://nodejs.org/docs/latest-v24.x/api/net.html
[node-worker]: https://nodejs.org/docs/latest-v24.x/api/worker_threads.html
[libuv-pipe]: https://docs.libuv.org/en/v1.x/pipe.html
[libuv-win-pipe]: https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/win/pipe.c
[node-quic]: https://github.com/nodejs/node/blob/v24.22.0/doc/api/quic.md
[xnu-uipc]: https://github.com/apple-oss-distributions/xnu/blob/xnu-12377.121.6/bsd/kern/uipc_usrreq.c
[html-structured]: https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
[dotnet-mmf]: https://learn.microsoft.com/en-us/dotnet/api/system.io.memorymappedfiles.memorymappedfile.createnew
[dotnet-vt]: https://learn.microsoft.com/en-us/dotnet/api/videotoolbox.vtcompressionsession
[vt-low-latency]: https://developer.apple.com/documentation/videotoolbox/kvtvideoencoderspecification_enablelowlatencyratecontrol
[wwdc21]: https://developer.apple.com/videos/play/wwdc2021/10158/
[mf-dxgi]: https://learn.microsoft.com/en-us/windows/win32/api/mfapi/nf-mfapi-mfcreatedxgisurfacebuffer
[mf-vp]: https://learn.microsoft.com/en-us/windows/win32/medfound/video-processor-mft
[mf-lowlatency]: https://learn.microsoft.com/en-us/windows/win32/medfound/codecapi-avlowlatencymode
[mf-h264]: https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder
[intel-media]: https://github.com/intel/media-driver/blob/master/docs/media_features.md
[nvenc-note]: https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-application-note/index.html
[parsec]: https://parsec.app/blog/parsec-game-streaming-total-latency-at-240-frames-per-second-c0818cc0daa5
[youtube]: https://support.google.com/youtube/answer/2853702
[webcodecs]: https://www.w3.org/TR/webcodecs/
[webgpu]: https://www.w3.org/TR/webgpu/
[webgl]: https://registry.khronos.org/webgl/specs/latest/1.0/
[secure-contexts]: https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
[safari-164]: https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
[safari-264]: https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
[arb-pbo]: https://registry.khronos.org/OpenGL/extensions/ARB/ARB_pixel_buffer_object.txt
[arb-sync]: https://registry.khronos.org/OpenGL/extensions/ARB/ARB_sync.txt
[ws-standard]: https://websockets.spec.whatwg.org/
[offscreen-canvas]: https://html.spec.whatwg.org/multipage/canvas.html#the-offscreencanvas-interface
[wsstream]: https://chromestatus.com/feature/5189728691290112
[desynchronized]: https://developer.chrome.com/blog/desynchronized
[webtransport]: https://www.w3.org/TR/webtransport/#certificate-hashes
