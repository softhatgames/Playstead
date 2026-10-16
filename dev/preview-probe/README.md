# Preview probe

The technical prototype from the [roadmap](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ROADMAP.md): can a code-first game on a supported stack send its frames into Playstead's preview fast enough, and take code changes while it runs ([decision 0020](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0020-native-games-send-frames-to-the-preview.md))? Each run is recorded in `results/`, so another technology can be measured the same way and compared.

It is research tooling, not part of Playstead. The relay stands in for Playstead's host and the viewer for its preview; the message format below is the probe's own, not the harness contract's wire format, which remains open.

## Run it

Needs the [.NET 10 SDK](https://dotnet.microsoft.com/download) for the MonoGame subjects. Run `pnpm install` in this folder once, and the commands below from it. A preview window opens above other windows: leave it uncovered and the keyboard alone while the probe measures, for about a minute.

| Command                                                          | What it does                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm probe:preview`                                             | Measures the default subject, MonoGame DesktopGL, and records the result.                                                                                                                      |
| `pnpm probe:preview --frames iosurface`                          | On macOS, the game shares each frame on the GPU instead of sending its pixels; see [Shared GPU frames](#shared-gpu-frames).                                                                    |
| `pnpm probe:preview --subject monogame-windowsdx --frames d3d11` | The same on Windows, with MonoGame's Direct3D 11 version.                                                                                                                                      |
| `pnpm probe:preview --interactive`                               | After measuring, keeps the preview open for you to play until you close it or press Enter, then asks whether you heard the beeps and how it felt compared with Play, and records your answers. |
| `pnpm probe:preview play`                                        | The game in its own window, as Play would show it, to compare the feel. Arrow keys move, Space beeps, a click moves the square, Escape quits.                                                  |
| `pnpm probe:preview compare`                                     | A table of every recorded result.                                                                                                                                                              |
| `--subject <name>`                                               | Another subject from `subjects/`. `monogame-windowsdx` is the same game on MonoGame's Direct3D 11 version, for Windows only.                                                                   |
| `--seconds <n>`, `--note "<text>"`                               | How long to measure frames (default 10), and a note to record with the result.                                                                                                                 |
| `--show-game-window`                                             | Leaves the game's own window visible during a preview run.                                                                                                                                     |

A failed run is recorded too, with its problem, including a game that cannot send frames the way `--frames` asked; the console names the log to read. Ctrl+C stops everything and restores the reload file; it records nothing while measuring, but keeps the measurements once an interactive run has reached play.

### Shared GPU frames

`--frames iosurface` measures the fastest route the [frame transport research](../../docs/research/preview-frame-transport.md) found, on macOS. The game copies each finished frame on the GPU into one of three global IOSurfaces and sends the relay only its header, the surface's ID and its slot. The relay passes that to Electron's main process, which looks the surface up with a small native module, imports it with Electron's experimental `sharedTexture` module and sends it to the page, whose preload hands it over as a `VideoFrame`. The page copies it into its own texture on the GPU as it arrives, so the surface goes back to the game at once, and a frozen frame stays on screen. When every process has released a surface, the game may draw into it again.

The native module is `viewer/native/iosurface.c`, built with `clang` on first use; it needs Xcode's command line tools (`xcode-select --install`). Global IOSurfaces are deprecated as insecure, because any local process can read one by guessing its ID; a real shell would pass Mach ports instead. Shared frames are checked against their marker blocks every 15th frame, read back from what the page drew.

`--frames d3d11` is the same route on Windows, for the `monogame-windowsdx` subject. Electron imports Direct3D 11 textures on Windows, and OpenGL reaches those only through a driver extension that may be missing. The game copies each frame into one of three Direct3D 11 textures shared through NT handles, which only work in the process that holds them. The shell names its process to the relay, which tells the game, and the game duplicates its handles into the shell; the frame message carries the handle's value there instead of an IOSurface ID. Electron imports a handle as it is, so Windows needs no native module. The subject asks MonoGame for its HiDef profile: the default, Reach, gives a Direct3D feature level 9_3 device, which cannot create textures shared through NT handles. It also asks Windows for a 1 ms timer, as SDL does for DesktopGL: otherwise each process keeps a timer of about 15.6 ms, which MonoGame's WindowsDX sleeps between frames by, and frames come unevenly. It opts out of Windows 11 ignoring that request while its window is hidden. The game reports its feature level with its graphics API, and the game window starts off the screen, so it does not flash up before it hides. The game and Electron must use the same graphics adapter, which a laptop with two GPUs may not.

## What a run measures

1. **Build.** Restores packages, then builds, timing the build.
2. **Start.** Starts the game's development build with its code reloader (`dotnet watch` for MonoGame), its window hidden. It connects to the relay, says hello with its runtime, library, graphics adapter, input path and sound status, and starts sending frames.
3. **Clocks.** The game, relay and viewer each time events with their own wall clock. The relay and the runner ask the game and the viewer for the time seven times each and keep the fastest round trip; an offset beyond 2 ms plus half that round trip marks the measurement suspect.
4. **Frames, for 10 s.** The game draws each 1280×720 frame off-screen, reads it back and sends it. The relay forwards it to the viewer, which draws it on the next display refresh. One frame is on its way to the viewer at a time; a newer frame replaces one waiting behind it, as a preview must not queue them. Recorded: frames rendered and shown per second, the gaps between frames shown, the **game's pacing** (the gaps between consecutive frames it made, of those shown), the **frame delay** from the game finishing a frame to the viewer drawing it, and where that time goes.
5. **Input.** The viewer receives 24 arrow-key presses, a click and Space as input events from Electron, and sends them through the relay to the game. Keys become SDL events, so MonoGame's own `Keyboard.GetState()` reads them as it reads a keyboard; MonoGame reads the mouse from the system rather than from events, so a click moves the square through the game's own code. Recorded: **input to display**, from the key event to the first frame drawn after the game handled it, and the **added delay over Play**: input transport plus frame delay, the parts a game in its own window does not have.
6. **Code reload.** Edits `ReloadMarker.cs` while the game runs, one change at a time: a method body, a new method, a lambda, and a change to a class's base type, which the runtime cannot apply without a restart. Each changes the marker the game draws, so the probe sees when the change reached the screen and whether the game restarted. The file is restored afterwards.
7. **Measurement check.** The relay holds every frame for an extra 100 ms. The measured frame delay must rise by 100 ms, within 10 ms, or the result is marked suspect.
8. **Freeze.** The page freezes its picture for a second while frames keep arriving, as drawing feedback over a frozen frame will, and checks that the frozen picture is still the frame it froze on.
9. **Sound.** The game beeps at start and on Space and reports whether playing failed. Only a person can say whether it was heard: use `--interactive`.

Every frame also carries its input number, reload marker and frame number as black and white blocks in its top-left corner; the viewer reads them from the pixels it drew and counts mismatches with the header, which shows the pixels are the frame the header describes.

The pass marks in `run.mjs` are proposed, not agreed: 57 frames shown per second with at most 1% of gaps over two frames, an added delay of at most 50 ms for 95% of inputs, and every code change that needs no restart shown within 2 s without one. Each result records the marks it was judged by alongside its raw numbers.

## Results

Each run writes two files to `results/`, named by time, platform, architecture and subject. Runs from before the Codex sandbox option was removed end in `-sandbox`:

- `<run>.json`: the computer, display rate, tools, versions, settings, summaries, verdicts, problems and any manual answers. Home folders are written as `~`.
- `<run>.samples.json`: every drawn frame's and input's times, in milliseconds from the first frame, so a summary can be checked by hand.

They are measurements of the probe, not game outputs: commit them to keep them. `pnpm probe:preview compare` reads every `<run>.json`. Compare rows with the same display rate: the wait for the next refresh is part of the frame delay.

## Add a technology

A subject is a folder in `subjects/` with a game and a `subject.json`:

- `name` and `technology`: recorded with each result.
- `platforms`: where it runs, as Node.js names them, such as `win32`; every platform if absent.
- `frames`: how it can send frames, such as `["raw", "iosurface"]`; `raw` only if absent.
- `versions`: commands whose first line of output records a tool's version.
- `environment`: variables for every command.
- `restore`, `build`, `preview` and `play`: commands run in the subject's folder. `preview` must start the development build with its code reloader; `{address}` becomes the relay's address and `{frames}` the route. `showWindowArgument` is added for `--show-game-window`.
- `crashPattern`: output that means the game stopped, so a broken start fails fast.
- `reload`: the file to edit, the marker the game draws at first, and each edit as `[from, to]` replacements with the marker it should show and whether it needs a restart.

The game connects to the address it is given: a Unix socket path, or on Windows a named pipe written `\\.\pipe\<name>`. Every message is a little-endian `u32` length counting the bytes after it, a `u8` type and a payload. Type 1 is UTF-8 JSON; type 2 is a frame; type 3 is a shared frame: the header, then a `u32` surface ID or, on Windows, handle, and an `i32` slot.

| Frame header byte | Field                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| 0                 | `u32` frame number                                                          |
| 4, 8              | `u32` width and height                                                      |
| 12                | `u32` the last input number the game handled                                |
| 16                | `i32` the reload marker drawn                                               |
| 20                | `u32` flags: bit 0 set when rows run bottom to top                          |
| 24                | `f64` when the update for this frame started                                |
| 32                | `f64` when the game finished issuing the frame's drawing                    |
| 40                | `f64` when the pixels were read back                                        |
| 48                | `f64` when sending started                                                  |
| 56                | `f64` when the game received the input at byte 12                           |
| 64, 72            | `f64` filled by the relay: when the frame arrived and when it was passed on |

Times are wall-clock milliseconds since the Unix epoch, with fractions. The time at byte 32 is taken when the game has issued its drawing, which the GPU may still be doing, so reading back includes the rest; another subject should take it at the same point. The RGBA pixels follow the 80-byte header.

The game sends JSON messages `hello` (once per process, with `pid`, runtime, library and input details), `audio` (`ok`, `error`), `reloaded` (`time`, after code changes are applied) and `clock` (`id`, and `time`, when the request arrived). The relay sends `input` messages with `seq`, `kind` (`key` or `mouse`), `code`, `down`, `x` and `y`; `clock` requests with an `id`; `released` with the `slot` of a shared frame every process has let go; and `shell` with the `pid` of the shell's main process. The game also draws its input number, reload marker and frame number as rows of 32 eight-pixel blocks, white for 1, from the top-left corner.

## Limits

- The probe times frames to when the viewer drew them, not to light on the screen; the compositor adds up to a refresh, as it does for the game's own window.
- The added delay includes waiting for the preview's next display refresh, which a game in its own window also waits for, so it overstates the difference by up to one refresh.
- Frame contents do not change the cost of raw frames, but the scene is simple: compressed frames would need representative content before their sizes mean anything.
- Input comes from events Electron injects into the page, timed from each event's own timestamp. A person's typing goes through the same path, plus the keyboard.
- The runner drives the viewer through Electron, not Playwright: Playwright reports every WebSocket frame over the DevTools protocol, which on its own slowed the page to about 45 frames per second.
- The viewer is a standalone page in Electron with no Node access, not Playstead's interface, and the relay is not Playstead's host. The relay's and the runner's WebSockets accept only connections carrying the run's random token.
- Sound is reported by the game; whether it was heard is a person's answer.
