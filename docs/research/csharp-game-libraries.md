# C# game libraries, and the combinations to recommend

- **Question:** Which C# libraries should games made with Playstead build on, across every part of game development, and which combinations should agents recommend for a given game ([#106][ticket])? Here a combination is a set of libraries used together, not the glossary's combination of prototypes. C# stays the technology for Playstead's games ([#103][ticket-103]), but [ADR 0004][adr-0004] says "C# is the decision; the library is not". The answer is know-how for Playstead's agents; the person decides.
- **Date:** 2026-10-17. All sources were accessed on this date, and the links checked again on 2026-10-18.
- **Outcome:** A recommendation; the founder decides. Keep MonoGame DesktopGL 3.8.6 as the foundation for 0.1's 2D platformer and 2D puzzle game. Of the five foundations measured here, it is the only complete game framework whose packages carry native libraries for all six desktops. Agents know its XNA interface best, and its costs match the others: a one-line rebuild in 0.60 s, a change shown by Hot Reload in about 60 ms (0.64 s for the first), the first frame in 0.46 s, a 1280×720 frame read back in 2.1 ms, and a NativeAOT export of 9.3 MB. It comes with six conditions for 0.1 ([below](#the-foundation-for-01)), and three need work. With vsync on and the display asleep, its first frame never finishes. It ships OpenAL Soft, which is LGPL, without the LGPL text. Its OpenGL renderer on Windows on Arm is still untested. FNA 26.10 is the strongest alternative: permissive natives, Metal through SDL_GPU, the fastest read-back (1.0 ms) and clean runs with the display asleep, but no Windows arm64 natives, and it comes as source. For later games that need their own renderer or frames without a window, SDL3 through Eduard Gushchin's SDL3-CS is the low-level foundation to use. Raylib-cs suits short prototypes only; Silk.NET and OpenTK are not foundations for a new game. Every foundation replayed the same game state on arm64 and x64, because the simulation used only plain arithmetic: many `System.Numerics` helpers and C runtime maths functions differ between the two, and a JIT build and its NativeAOT export can differ on one computer. Elsewhere the catalogue recommends a small set per area, such as Gum for menus, Hexa.NET.ImGui for in-game tools, FontStashSharp for text, Box2D.NET where a 2D game needs physics, the game's own arrays of structs for state, System.Text.Json for saves, and xUnit v3 with CsCheck for tests. Playstead should keep this know-how as one catalogue data file, generate from it one choosing skill per stack, and copy that skill into each game.
- **Versions:** .NET SDK 10.0.103 with runtime 10.0.3; 10.0.13 is current. Foundations measured: MonoGame.Framework.DesktopGL 3.8.6 (SDL 2.32.10, OpenAL Soft 1.24.3); FNA 26.10 with the `fnalibs-apple` artefact built on 2026-10-17 (an SDL 3.4.19 development build, FNA3D and FAudio 26.10); Raylib-cs 8.1.0 (raylib 6.0); ppy.SDL3-CS 2026.1002.1 (an SDL 3.5.0 development build); Silk.NET 2.23.0 with Silk.NET.OpenAL.Soft.Native 1.23.1. Agents: Codex CLI 0.163.0 with GPT-6.1-Sol, and Claude Code 2.1.301 with Claude Opus 5.5, each at its default effort. Every other library is described at the version its catalogue row gives.
- **Local evidence:** an Apple M3 Max (10 performance and 4 efficiency cores, 36 GB) with macOS 26.6.2 and its screen locked. Everything ran in a scratch folder under `/tmp`, deleted afterwards, with every download and cache inside it. The same small game was written for each foundation and measured by script; two foundations were also measured with the game grown to about 100,000 lines; Codex and Claude each wrote the game for MonoGame and FNA. Nine research agents read the primary sources for the catalogue, and this note condenses their findings. Local results are marked **Observed**.

Labels: **Documented** (official documentation, repositories, packages, source code or release notes), **Observed** (the local runs and package inspections), **Inference** (reasoning, not a source) and **Unconfirmed** (not established; the reason is given). In the catalogue tables, facts come from each library's own repository and package (**Documented** or **Observed**), and the verdicts are **Inference**.

## The foundations

### What counts as a foundation

- **The test.** A foundation is the library a game's engine is built on: a framework, or a set of bindings, that owns the window, input, drawing and sound; is maintained; runs on .NET 10; and reaches the six desktops: macOS, Windows and Linux, each on arm64 and x64.
- **How the candidates fare (Observed in the packages; Documented in the projects).**

| Candidate                 | Owns                                                         | Native libraries for the six desktops                                                                                                 | Maintained                                                                    | Measured                                              |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| MonoGame DesktopGL 3.8.6  | All four: SDL 2, OpenGL, OpenAL Soft                         | All six in the package ([#84][note-export])                                                                                           | MonoGame Foundation; 55 commits in 90 days                                    | Yes                                                   |
| FNA 26.10                 | All four: SDL3, FNA3D, FAudio                                | Five: `fnalibs` has no Windows arm64 build ([fnalibs][fnalibs-readme])                                                                | Monthly releases; 235 commits in 90 days                                      | Yes, as the XNA alternative                           |
| Raylib-cs 8.1.0           | All four: raylib with GLFW, OpenGL and miniaudio             | Four in the package; raylib's own 6.0 release adds the two arm64 builds ([README][raylibcs-readme], [6.0][raylib-60])                 | "Passively maintained"                                                        | Yes, with raylib's builds                             |
| ppy.SDL3-CS 2026.1002.1   | All four: SDL3 window, input, renderer and GPU, audio        | All six, plus phones; ships an SDL 3.5.0 development build, which SDL calls unsuitable for stable software ([versions][sdl-versions]) | ppy (osu!); 11 commits in 90 days                                             | Yes, as raw bindings                                  |
| SDL3-CS 3.4.18 (Gushchin) | All four, plus image, text and mixer libraries               | All six, stable SDL 3.4.18 ([README][eg-sdl3-readme])                                                                                 | 156 commits in 90 days                                                        | No: same SDL functions as ppy.SDL3-CS (**Inference**) |
| Silk.NET 2.23.0           | All four: GLFW or SDL, OpenGL, Vulkan, WebGPU, OpenAL Soft   | All six ([v2.23.0][silk-2230])                                                                                                        | "2.X investment is currently limited" ([README][silk-readme]); 3.0 unreleased | Yes, as a broad binding set                           |
| Foster 0.4.2              | Window, input, drawing; no sound ([#19][foster-audio-issue]) | No Windows arm64 ([package][nuget-foster])                                                                                            | Noel Berry; 48 commits in 90 days                                             | No: no sound                                          |
| KNI 4.3.9001              | All four: SDL 2.0.20, OpenGL, OpenAL Soft 1.17–1.22          | No Windows or Linux arm64 ([package][nuget-kni-sdl2gl])                                                                               | One maintainer                                                                | No                                                    |
| OpenTK 4.9.4              | Window, input, OpenGL; OpenAL without native libraries       | GLFW without either arm64 build ([package][nuget-opentk-glfw])                                                                        | Stable line from 2025-03; 5.0 in preview since 2022                           | No                                                    |
| SFML.Net 3.0.0            | All four                                                     | All six                                                                                                                               | No commits in 90 days                                                         | No                                                    |

Engines with their own editor, scene model or build, such as Stride, Godot, Murder, FlatRedBall and Prowl, are outside what ADR 0004 allows; the [catalogue](#frameworks-and-engines) classifies them.

### The small game

- **What it is (Observed).** The game from [#103's note][note-odin]: a 1280×720 window, a 32-pixel sprite moved by the arrow keys, and a simulation of 400 entities at 60 ticks a second, with a check between every pair, in its own project that references no foundation. The simulation uses only `+ - * /` and comparisons on `float`, a SplitMix64 generator and a fixed script of 3,000 ticks of actions; its fingerprint is an FNV-1a hash of the bits of the whole game state. Each game draws the entities and the sprite, turns the arrow keys into actions, and opens the audio device with a short silent sound.
- **The switches (Observed).** Every game has the same switches: report the time from process start to the first presented frame; render each frame into a 1280×720 target and read it back; start hidden; print the fingerprint without a window; and log the frame on which the sprite's tint changes. Vsync is off unless asked for, since with it MonoGame's first frame never finished (see [below](#with-the-display-asleep-or-no-window)). Frames are capped at 60 a second, since some foundations ignore vsync behind the lock screen.
- **The builds (Observed).** A clean build starts with no build outputs but with packages downloaded; the build servers stay warm. The one-line change edits the tint returned by one method in the simulation project; Hot Reload is timed from saving that file to the end of the first frame drawn with the new tint, under `dotnet watch` in `Debug`. Figures are medians of five builds or seven edits. Exports are `osx-arm64` builds: self-contained and untrimmed as [#84][note-export] recommends, and NativeAOT where it works, with debug symbols excluded from the size.
- **Conditions (Observed).** Behind the lock screen the display turns itself off every 30 seconds, and overlapping one-second `caffeinate -u` assertions turned it on again within the same second. A run that found no display was retried; none of the reported runs needed a retry. The x64 builds ran under Rosetta 2.

### Results

Medians, seconds unless marked (**Observed**):

| Measure                                                        | MonoGame DesktopGL | FNA                 | Raylib-cs          | SDL3 (ppy.SDL3-CS) | Silk.NET           |
| -------------------------------------------------------------- | ------------------ | ------------------- | ------------------ | ------------------ | ------------------ |
| Clean build                                                    | 0.75               | 1.17 (FNA compiled) | 0.82               | 0.75               | 0.76               |
| No-op build                                                    | 0.57               | 0.58                | 0.62               | 0.56               | 0.55               |
| One-line rebuild, `Debug`                                      | 0.60               | 0.62                | 0.67               | 0.59               | 0.59               |
| One-line rebuild, `Release`                                    | 0.60               | 0.61                | 0.61               | 0.59               | 0.60               |
| Hot Reload: first edit                                         | 0.64               | 0.61                | 0.64               | 0.66               | 0.64               |
| Hot Reload: later edits                                        | 0.062              | 0.074               | 0.060              | 0.061              | 0.059              |
| `dotnet watch` start to first frame                            | 2.10               | 2.36                | 2.01               | 2.07               | 1.93               |
| First frame: `Debug` / self-contained / NativeAOT              | 0.46 / 0.45 / 0.42 | 0.35 / 0.33 / 0.24  | 0.21 / 0.21 / 0.20 | 0.22 / 0.22 / 0.22 | 0.26 / 0.25 / 0.20 |
| Read-back of one 1280×720 frame, `Debug`, ms (95th percentile) | 2.14 (2.98)        | 1.03 (1.71)         | 2.03 (2.75)        | 2.76 (3.75)        | 1.51 (2.02)        |
| Self-contained export: folder / `.tar.gz`, MB                  | 90 / 34            | 93 / 35             | 87 / 32            | 86 / 32            | 88 / 32            |
| NativeAOT export: folder / `.tar.gz`, MB                       | 9.3 / 3.7          | 12.6 / 4.9          | 4.9 / 2.1          | 4.3 / 1.7          | 3.8 / 1.7          |
| Fingerprint, arm64 and x64                                     | Same               | Same                | Same               | Same               | Same               |
| x64 under Rosetta, frames a second (cap 60)                    | 31                 | 35                  | 44                 | 39                 | 43                 |

- **Builds and Hot Reload (Observed).** The five foundations build within 0.1 s of each other, because the simulation project, not the foundation, is what changes. FNA's clean build compiles FNA itself, about 0.5 s more; with FNA already compiled it took 0.69 s. Hot Reload applied every edit; after the first edit following each start of `dotnet watch`, the first frame drawn with the change came 42 to 126 ms after saving. These match the C# results in [#103's note][note-odin] (0.49 s rebuild, 0.06 s Hot Reload).
- **Start-up (Observed).** Raylib-cs and SDL3 reach their first frame in about 0.2 s, FNA in 0.33 s and MonoGame in 0.45 s. NativeAOT saves at most 0.1 s, so most of the time goes on the window and the graphics context, as [#84][note-export] found (**Inference**).
- **Read-back (Observed, Documented).** Every read-back measured here is synchronous: MonoGame calls `glGetTexImage` inside `BlockOnUIThread` ([source][mg-texture-getdata]), FNA's SDL_GPU driver waits on fences ([source][fna3d-sdlgpu-readback]), raylib and Silk.NET read OpenGL pixels, and SDL3's `SDL_RenderReadPixels` returns a surface. A game using SDL_GPU directly can download through a transfer buffer and wait on a fence later ([SDL_gpu.h][sdl-gpu-h]); that path was not measured.
- **NativeAOT (Observed).** All five ran as NativeAOT builds. FNA needed its documented `DirectPInvoke` and `NativeLibrary` items, without which its first SDL3 call failed ([Appendix A][fna-aot]), and it published with eight kinds of trim and AOT warnings. Silk.NET failed at start with "Couldn't find a suitable window platform. (none registered)" until the game called `GlfwWindowing.RegisterPlatform()` and `GlfwInput.RegisterPlatform()` itself ([troubleshooting][silk-troubleshooting]).
- **Under Rosetta (Observed).** Every x64 build ran and drew frames, at 31 to 44 frames a second against the cap of 60, and took 0.3 to 1.0 s to its first frame.

### At about 100,000 lines

A generator like the one in [#103's note][note-odin] added 440 kinds of entity to the simulation project, each with its own state, update, helpers, hash and tint, all run every tick: 100,085 lines (**Observed**).

| Measure, seconds                     | MonoGame     | FNA          | MonoGame, simulation without `IsAotCompatible` or nullable analysis |
| ------------------------------------ | ------------ | ------------ | ------------------------------------------------------------------- |
| Clean build                          | 3.50         | 3.66         | 1.32                                                                |
| No-op build                          | 0.58         | 0.59         | 0.58                                                                |
| One-line rebuild, `Debug`            | 3.31         | 3.35         | 1.23                                                                |
| One-line rebuild, `Release`          | 3.29         | 3.34         | 1.17                                                                |
| Hot Reload: first edit / later edits | 0.80 / 0.061 | 0.82 / 0.063 | –                                                                   |
| First frame, `Debug`                 | 0.48         | 0.31         | –                                                                   |
| NativeAOT export, MB                 | 10.6         | 13.9         | –                                                                   |

- **The analysers cost two seconds a rebuild (Observed, Documented).** `IsAotCompatible` turns on the AOT and single-file analysers, which then run in every build ([SDK targets][sdk-analyzers]). On the 100,000-line simulation they nearly tripled the one-line rebuild: 3.29 s with only `IsAotCompatible`, 1.21 s with only nullable analysis, and 1.23 s with neither. Without them the figures match the 1.33 s in [#103's note][note-odin]. **Inference:** a game should run those analysers in CI and release builds, not in the `Debug` builds the preview runs.
- **Hot Reload does not grow with the game (Observed).** Later edits still showed on the next frame in about 60 ms, and the first edit after `dotnet watch` started took 0.8 s.
- **Replay (Observed).** The grown simulation gave the fingerprint `1EE23158E5F0CB1B` on arm64 and on x64, with both foundations.

### With the display asleep or no window

With the display asleep (`pmset displaysleepnow`, checked with `system_profiler`), each `Debug` build was asked for 120 frames within 25 s (**Observed**):

| Foundation         | Visible window, vsync on              | Visible window, vsync off | Hidden window, read-back each frame |
| ------------------ | ------------------------------------- | ------------------------- | ----------------------------------- |
| MonoGame DesktopGL | No frame: blocked in SDL's vsync wait | 120 frames                | 120 frames, 2.43 ms a read-back     |
| FNA                | 120 frames                            | 120 frames                | 120 frames, 1.43 ms                 |
| Raylib-cs          | Does not start                        | Does not start            | Does not start                      |
| SDL3               | 120 frames                            | 120 frames                | 120 frames, 2.82 ms                 |
| Silk.NET (GLFW)    | 120 frames                            | 120 frames                | 120 frames, 1.60 ms                 |

- **MonoGame and vsync (Observed, Documented).** A sample of the blocked process showed its main thread in `Cocoa_GL_SwapWindow`, waiting in `SDL_CondWait`. SDL 2 on macOS implements vsync by waiting, with no timeout, for a `CVDisplayLink` signal ([SDL_cocoaopengl.m][sdl2-cocoa-swap]); when the display sleeps, the signal stops (**Inference**). With vsync on, the first frame also never finished behind the lock screen while the display was switching itself off every 30 seconds. MonoGame with vsync off, and FNA, SDL3 and Silk.NET in every mode, kept drawing.
- **raylib without a display (Observed).** raylib printed "GLFW: Failed to determine Monitor to center Window" and "SYSTEM: Failed to initialize platform", with or without its hidden-window flag, and the game loop ended at once; the `CloseWindow` call that followed then crashed the process in `rlUnloadRenderBatch` (macOS crash reports). [#103][note-odin] saw the same failure to start.
- **No window at all (Documented, Observed).** Every game printed its fingerprint without creating a window, because the simulation depends on no foundation. For frames, MonoGame and FNA always create a window, hidden until `Game.Run()` shows it, so a host that drives `RunOneFrame()` and `Tick()` keeps it hidden ([Game.cs][mg-runoneframe]); neither has a null graphics device ([MonoGame #7121][mg-headless-issue], [FNA][fna-nulldevice]). SDL3 can draw with no window at all, through an SDL_GPU device or a software renderer ([SDL_gpu.h][sdl-gpu-h]). SDL's `offscreen` video driver needs EGL ([source][sdl-offscreen]), which macOS lacks, so on a Mac a hidden window is the practical route (**Inference**).

### Replay across arm64 and x64

A probe hashed the results of 45 operations over the same 200,000 inputs each, on arm64 and on x64 under Rosetta, as JIT and as NativeAOT builds (**Observed**). Under Rosetta, x64 .NET reports SSE4.2 but no AVX, AVX2 or FMA; with `ROSETTA_ADVERTISE_AVX=1` the JIT sees AVX, AVX2 and FMA, but a NativeAOT build still does not use them.

| Operations (compared with arm64 JIT)                                                                                                                     | arm64 NativeAOT | x64 JIT | x64 JIT with AVX | x64 NativeAOT |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------- | ---------------- | ------------- |
| `+ - * /`, `Sqrt`, `FusedMultiplyAdd`; `Vector2` `Dot`, `Length`, `Distance`, `Normalize`; `Vector3.Cross`; `Matrix3x2` multiply; `Vector128.Sum`; casts | Same            | Same    | Same             | Same          |
| `float.SinPi`, `CosPi`, `TanPi`, `Hypot`; `MathF.Atan`, `Atan2`; a lerp written as `a + (b - a) * t`                                                     | Same            | Same    | Same             | Same          |
| `MultiplyAddEstimate`, `float.Lerp`, `Vector2.Lerp`, `Reflect`, `Transform`, `Vector4.Lerp`, `Matrix4x4` multiply                                        | Same            | Differ  | Same             | Differ        |
| `MathF.Sin`, `Cos`, `Tan`, `Asin`, `Pow`, `Exp`, `Log`; `Math.Sin`, `Pow`; `ReciprocalEstimate`; `Quaternion.Slerp`                                      | Same            | Differ  | Differ           | Differ        |
| `MathF.SinCos`, and `Matrix3x2.CreateRotation` and `Quaternion.CreateFromAxisAngle`, which use it                                                        | Differ          | Same    | Same             | Same          |

- **What it shows (Observed, Documented).** Plain arithmetic replays everywhere: the JIT never fuses `a*b + c` by itself ([lowerarmarch.cpp][dotnet-jit-contraction]). Since .NET 9 many `System.Numerics` helpers call `MultiplyAddEstimate` ([Vector2.cs][dotnet-vector2-lerp]), which the arm64 JIT always fuses and the x64 JIT fuses only on processors with the whole AVX2 group, FMA included ([hwintrinsicxarch.cpp][dotnet-mae-x64]); a default x64 NativeAOT build never does ([InstructionSetHelpers.cs][dotnet-aot-isa]). So one helper gives different results on arm64, on an x64 PC with FMA and on one without, and a JIT build and a NativeAOT export of the same game disagree on an x64 PC with FMA; Microsoft calls such APIs "intentionally non-deterministic across hardware" ([design notes][dotnet-intrinsics-design]). `MathF.SinCos` also gave different results from the arm64 JIT and from arm64 NativeAOT on the same Mac. `Math` and `MathF` transcendental functions call the platform's C runtime ([Math.CoreCLR.cs][dotnet-math-crt]).
- **What it means (Inference).** By default a Mac cannot stand in for current x64 PCs in replay checks, because Rosetta presents a processor without FMA ([Rosetta][rosetta]). `ROSETTA_ADVERTISE_AVX=1`, which Apple does not document, made the x64 JIT fuse like a PC with FMA, but the C runtime under it is still Apple's. The replay check therefore needs real x64 Windows and Linux machines, and both JIT and NativeAOT builds. The [rules for the simulation](#the-sealed-simulation) list what is safe.

### What Codex and Claude wrote

Each agent got the same brief and the foundation's files, with no skills, plugins or MCP servers, and no saved sessions: the small game with a fingerprint mode, the simulation in its own project, and a warning that the fingerprint must match on any processor (**Observed**).

| Run              | Time  | Failed builds | Cause                                                                                                                | Its fingerprint, arm64 and x64 | Window                                                                                     |
| ---------------- | ----- | ------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| Codex, MonoGame  | 61 s  | 0             | –                                                                                                                    | `AEF75575E49A4B43`, same       | Not tried; ran when started outside the sandbox                                            |
| Codex, FNA       | 93 s  | 1             | `CS1501`: `SpriteBatch.Begin(samplerState: …)`, an overload MonoGame added and FNA, which keeps XNA's, does not have | `9F8A5E509472CA98`, same       | Failed inside Codex's sandbox: "The video driver did not add any displays"; ran outside it |
| Claude, MonoGame | 89 s  | 0             | –                                                                                                                    | `139845c371fb00ed`, same       | Ran                                                                                        |
| Claude, FNA      | 101 s | 0             | –                                                                                                                    | `0x4876D109ABBA4627`, same     | Ran, on Metal                                                                              |

- **What they chose (Observed).** All four simulations used integer fixed point with 8 fractional bits and no floating point at all, with a generator of their own (xorshift32 from Codex, SplitMix64 from Claude) and an explicitly ordered hash. That replays, but it rules out floating-point physics that would have been safe; a skill that names the safe operations would leave the choice open (**Inference**).
- **The one failure (Observed).** Codex wrote MonoGame's named-argument `SpriteBatch.Begin` overload, which FNA lacks, and fixed it in one step.
- **The sandbox (Observed, Inference).** Codex's workspace-write sandbox on macOS let it build and run the fingerprint, but its launch of the FNA game logged "Connection Invalid error for service com.apple.hiservices-xpcservice" and stopped with "SDL_Init failed: The video driver did not add any displays". Outside the sandbox the same build opened its window. The sandbox probably hides the window server; the **Technical prototype** ([#82][issue-82]) should confirm this under each permission mode.
- **What they know (Observed).** Asked from memory for the latest version of 50 libraries, Codex answered "unknown" for 27 and Claude for 9; Claude gave 26 more only as "2.x" or similar. Neither named a release after 2025: MonoGame 3.8.2 and 3.8.4 against 3.8.6, Raylib-cs 6.1.0 and 7.0.1 against 8.1.0, Silk.NET 2.22.0 against 2.23.0, xUnit v3 1.0.0 and "3.x" against 4.0.2.

## Fit with Playstead's games

### Six desktops, NativeAOT and trimming

- **The foundations (Observed).** MonoGame DesktopGL, SDL3 through either SDL3-CS package, and Silk.NET ship native libraries for all six desktops. FNA's `fnalibs` miss Windows arm64: a game would build SDL3, FNA3D, FAudio and Theorafile for it itself (**Inference**). Raylib-cs misses both arm64 builds that raylib 6.0 publishes. KNI, Foster and OpenTK miss at least one arm64 desktop ([summary][note-export]).
- **FNA's natives (Documented, Observed).** They come only as daily CI artefacts that "always [target] the latest development version of FNA" and expire after 90 days, so a game keeps its own copy; the build examined carried an SDL 3.4.19 development build ([fnalibs-dailies][fnalibs-readme]). FNA requires glibc 2.31 on Linux today and 2.41 from 1 April 2027 ([Appendix F][fna-glibc]); MonoGame's Linux libraries need glibc 2.34 ([#84][note-export]).
- **Windows on Arm (Unconfirmed).** MonoGame's arm64 Windows build arrived in 3.8.5 and MonoGame does not test it; what OpenGL a Windows on Arm laptop provides is still open ([#84][note-export]). Among other common picks, ImGui.NET has no linux-arm64 build, Hexa.NET.ImGui has an open Windows arm64 fault ([Hexa.NET.ImGui#90][hexa-imgui-90]), Valve ships no Windows arm64 Steamworks library ([Steamworks.NET][steamworksnet-releases]), FastNoise2's releases have no arm64 Windows or Linux build, and Magick.NET 15 dropped osx-x64 (**Observed** in their packages).
- **NativeAOT (Observed, Documented).** All five foundations ran as NativeAOT builds (above). It must be built on the target's own operating system ([#84][note-export]). Libraries that compile code at run time do not survive it: Roslyn scripting ([roslyn#73689][roslyn-73689]), C# mods loaded through `AssemblyLoadContext`, Harmony and MonoMod ([Harmony][harmony]), and MonoGame.Extended's tweening, which calls `Expression.Compile` ([Tweening][mge-tweening]). Reflection-heavy libraries such as Newtonsoft.Json may fail at run time. LGPL native libraries must stay separate shared libraries in a NativeAOT build ([Licences](#licences-for-the-games)).
- **Trimming (Documented).** MonoGame calls itself "mostly compatible with `PublishAot` and `PublishTrimmed`", and warns about custom content readers with generic collections ([packaging][mg-packaging]). [#84][note-export] recommended untrimmed exports for 0.1.

### Phones, the web and consoles, later

| Foundation | Phones                                                                     | The web                                                                | Consoles                                                                                                       |
| ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| MonoGame   | iPhone and Android; OpenAL Soft is linked statically on iPhone             | WebGL2 platform in an open pull request for 3.8.7 ([#9559][mg-web-pr]) | Xbox, PlayStation 4 and 5, Switch and Switch 2, through the console makers ([console access][mg-consoles])     |
| FNA        | iPhone and tvOS; "Android is not and cannot be supported" ([FAQ][fna-faq]) | Community builds only                                                  | Xbox GDK in public, Switch and PlayStation under agreement, all through NativeAOT ([Appendix B][fna-consoles]) |
| KNI        | Android and iPhone                                                         | Blazor and WebGL                                                       | None listed                                                                                                    |
| SDL3       | iPhone and Android                                                         | Emscripten                                                             | Ports for licensed developers                                                                                  |
| Raylib-cs  | None                                                                       | `browser-wasm`, new in 8.1                                             | None public                                                                                                    |

All **Documented** in each project's own pages, linked in the [catalogue](#frameworks-and-engines). MonoGame plans a Metal backend and its native platform code for every platform in 3.9, due 2027-06-30, and "a major evolution beyond the original XNA API" in 5.x, due 2028 ([milestones][mg-milestones]).

### Hot Reload in Debug

- **The same in every foundation (Observed).** The first edit after `dotnet watch` started took 0.6 to 0.8 s; after that, a change inside a method body reached the running game in about 60 ms, in all five foundations and at 100,000 lines. Hot Reload applies only in `Debug` ([#83][note-dotnet]).
- **MonoGame's template setting (Observed).** MonoGame's templates set `TieredCompilation=false` ([template][mg-template]). With it, edits still applied: one run took 593 ms for the first edit and 63 ms after that, as with tiered compilation; another took 828 ms, then 259 to 326 ms for four edits, then about 60 ms.
- **What forces a restart (Documented).** Adding a field to any struct, because Roslyn treats every struct as having a sequential layout; module initialisers and static registries, such as those that entity systems and serialisers generate, do not run again ([Roslyn][roslyn-enc-struct]). MonoGame, FNA and KNI define no `MetadataUpdateHandler` (**Observed** by code search). A change to the shape of game state therefore means a restart from the same scenario, with the state migrated or reset (**Inference**).

### The sealed simulation

The rules below come from reading .NET 10.0.13's source, cited in the [replay section](#replay-across-arm64-and-x64), and from the probe there (**Documented**, **Observed**).

- **May use.** `+ - * /`, negation and comparisons on `float`, `double` and integers; `Sqrt`, `Abs`, `CopySign`, `Floor`, `Ceiling`, `Truncate`, `Round`, `Min`, `Max`, `Clamp` and `%`; `FusedMultiplyAdd` where one rounding is wanted, which is exact everywhere but slow without hardware FMA; `float.SinPi`, `CosPi`, `TanPi` and `Hypot`, which .NET computes in managed code; and from `System.Numerics` only the `Vector2`, `Vector3` and `Vector4` operators, `Dot`, `Length`, `Distance`, `Normalize`, `Cross` and the other helpers that do not call `MultiplyAddEstimate`.
- **Use with care.** `Vector<T>`, whose width changes with the machine; NaN, whose bit pattern differs between x64 and arm64, so canonicalise it in fingerprints; integer fixed point (FixedMathSharp, FixPointCS) where a game wants no floating point at all; and Box2D.NET, whose plain maths should replay across architectures, though that is untested.
- **Must not use.**
  - Everything built on `MultiplyAddEstimate`: `Lerp`, `Reflect`, `Transform`, and `Matrix4x4` and `Quaternion` multiplication. Also `Matrix4x4.Invert`, which runs different algorithms on x64 and arm64 ([Matrix4x4.Impl.cs][dotnet-invert]), and the estimate and `*Native` methods.
  - Every C runtime function (`Sin`, `Cos`, `Tan`, `Asin`, `Atan`, `Atan2`, `SinCos`, `Exp`, `Log`, `Pow` and the rest), including those that matched here, since Windows and Linux have other C runtimes; and the helpers that call them, such as `Matrix3x2.CreateRotation` and `Quaternion.Slerp`.
  - The frameworks' rotation, perspective and slerp helpers, which call the C runtime's sine, cosine, tangent and arc cosine ([MonoGame][mg-vector2-rotate], [FNA][fna-matrix-trig]), and raylib's Raymath.
  - `System.Random`, whose state cannot be saved and whose implementation "isn't guaranteed to remain the same across major versions of .NET" ([docs][random-docs]).
- **Collections and hashes (Documented).** Never iterate `Dictionary`, `HashSet`, frozen or concurrent collections in the rules: their order is undefined. `OrderedDictionary<TKey,TValue>`, new in .NET 9, keeps insertion order. Sort with ordinal comparers and break ties by entity id, since `Array.Sort` is unstable. `string.GetHashCode` and `HashCode` change between processes ([HashCode][hashcode-docs]); a fingerprint hashes a canonical form the game writes, with `XxHash128` or `XxHash3` from `System.IO.Hashing`, never raw struct bytes, which include padding ([XxHash3][xxhash3-docs]).
- **Randomness (Inference).** A generator written in the game, such as SplitMix64, xoshiro or PCG, with its state in the game state. MonoGame's `MathHelper.Random` is deterministic, but setting its `State` advances it once, so restoring `State` from a snapshot does not resume the same sequence ([source][mg-random]).
- **Threads (Documented).** Every entity system's job runner sizes its work from the number of cores, so only work where each entity writes its own data is deterministic; Arch's command buffer also replays in the order threads recorded ([CommandBuffer.cs][arch-commandbuffer]). **Inference:** a parallel simulation partitions work by data and merges in a fixed order on the Task Parallel Library, never with its reductions or PLINQ.
- **Culture (Documented).** .NET takes ICU from the operating system on all three desktops, so culture-sensitive parsing, casing and sorting can differ between players' machines; the analysers CA1304, CA1305, CA1307, CA1309, CA1310 and CA1311 are off by default ([ICU][dotnet-globalization]). **Inference:** the simulation uses ordinal comparison, parses content files with `CultureInfo.InvariantCulture`, and makes those analysers errors.
- **State as data (Inference, Documented).** The game's own arrays of structs, indexed by id and generation, are the safest state root: a snapshot is a block copy. In an entity system's own words, a component is data attached to an entity and a world holds them all; neither is the glossary's part or game state. Of the entity systems, StaticEcs can write its whole world as a snapshot and iterates in a fixed order ([StaticEcs][staticecs]); Arch, the most downloaded, names archetypes by a 32-bit `HashCode` that is seeded differently in every process and compares them by hash alone, so component sets can merge differently on each run ([Arch #303][arch-303]); a fix merged on 2026-10-17 awaits a release after 2.1.0.
- **Physics (Documented, Observed).** Box2D.NET is a pure C# port of Box2D 3.1 with plain floating-point maths and Box2D's own trigonometry, and has not yet ported Box2D's new snapshot and restore ([Box2D.NET][box2dnet]); it should therefore replay across architectures, though no one has tested that (**Inference**). Every native Box2D 3.1 package examined contained fused instructions in at least one arm64 build, so none can be trusted to replay across architectures (**Inference**). Jitter2's deterministic mode claims cross-platform replay but has no snapshots; BEPUphysics promises the same machine only; Jolt can do both, but JoltPhysicsSharp's natives are built without its deterministic option ([Jitter2][jitter2-determinism]).
- **Scripts (Documented).** Lua-CSharp and MoonSharp are managed and keep table order; native Lua seeds its string hashes from the time and addresses, so `pairs` order can change between runs ([Lua 5.4][lua-seed]). Every interpreter examined implements `math.sin` and `pow` through `System.Math`, so simulation scripts need the game's own maths.

### Frames for the preview, and headless runs

- **Read-back (Observed).** 1.0 to 2.8 ms for a 1280×720 frame, synchronous in all five foundations, so the preview costs part of each frame. MonoGame 3.8.6 also added `RenderTarget2D.FromNativeHandle()` and native device handles, and FNA3D exposes its renderer's objects, which are the routes to sharing frames without copying them ([#9535][mg-9535], [FNA3D_SysRenderer.h][fna3d-sysrenderer]).
- **Without a display (Observed, Documented).** As measured above, MonoGame must draw without vsync, raylib cannot start, and the others run. On Linux CI, Mesa's software OpenGL and Vulkan must be installed explicitly beside `xvfb` ([runner images][runner-images]); Silk.NET packages SwiftShader, a CPU Vulkan driver, for all six desktops ([package][silk-swiftshader]); on Windows, FNA3D can use WARP with `FNA3D_D3D11_USE_WARP=1` ([source][fna3d-warp]). GitHub's macOS runners have only a paravirtual Metal device, which is reported unreliable ([#14840][runner-metal]).
- **Sound without a device, and offline (Documented).** OpenAL Soft needs `ALSOFT_DRIVERS=null`, or its loopback extension, which renders exactly as many samples as asked "to encode with a video" ([SOFT_loopback][oal-loopback]). SDL3 has `SDL_AUDIO_DRIVER=dummy` or `disk`, and SDL3_mixer 3.x renders on request with `MIX_Generate` ([SDL_mixer.h][sdl-mixer-generate]). miniaudio falls back to a silent device by itself, and its engine renders sound on request ([miniaudio.h][miniaudio]). FAudio and MonoGame document no way to render sound on request, so gameplay video rendered from a replay needs another sound library (**Inference**).
- **Stopping a run (Observed, Documented).** FNA registers a `ProcessExit` handler that calls `SDL_QuitSubSystem` ([FNAPlatform.cs][fna-processexit], [SDL3_FNAPlatform.cs][fna-programexit]). On SIGTERM, or `Environment.Exit`, .NET runs it on the finalizer thread; SDL then tries to hide the Cocoa window off the main thread, AppKit throws, and the process spins at 100% of a core while its game loop runs on. One such game ran for three hours before it was killed. MonoGame ignored `Exit()` called during its first frame. **Inference:** the development layer stops a run through the game's own loop, and kills it after a timeout.
- **Injected input (Documented).** MonoGame and FNA give `KeyboardState`, `MouseState`, `GamePadState` and `TouchCollection` public constructors ([MonoGame][mg-keyboardstate]); `SDL_PushEvent` does not change the state SDL reports, but SDL3's virtual joysticks inject real gamepad input ([SDL_events.h][sdl-push-event]); raylib's automation events write its internal input state. Input from the preview enters the game's input mapping in every case ([DEVELOPMENT-LAYER.md][devlayer-builds]).

## Licences for the games

What a game that ships each library must do (**Documented** in each licence; not legal advice):

| What the game must do                       | Examples                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing                                     | zlib in binary form ("an acknowledgment in the product documentation would be appreciated but is not required"): SDL 2 and 3, raylib, FNA3D, FAudio, MojoShader, MoonTools.ECS. Public domain, CC0 or MIT-0: stb, miniaudio, OpenSimplex2, DefaultEcs. Boost in binary form: Clipper2                                                                                                                       |
| Ship a notices file                         | MIT; BSD; ISC; Apache-2.0 (the licence text, and any NOTICE file's attributions); Ms-PL, which also requires that compiled code is distributed "only ... under a license that complies with this license": MonoGame, FNA, KNI, QuikGraph                                                                                                                                                                    |
| Credit in the documentation                 | FreeType's FTL, which reaches games through FreeTypeSharp, SDL3_ttf and SkiaSharp ([FTL][ftl]); libjpeg-turbo's IJG clause, "This software is based in part on the work of the Independent JPEG Group", inside SkiaSharp ([LICENSE.md][libjpeg-turbo]); BSD-3 notices "in the documentation and/or other materials", such as libogg, libvorbis and libtheora inside Theorafile                              |
| LGPL duties                                 | OpenAL Soft in MonoGame DesktopGL, KNI and Silk.NET; libgme inside ppy's SDL3_mixer; vkd3d inside SDL3-CS's shadercross natives; FFmpeg and libVLC; managed LGPL assemblies such as MP3Sharp and MoonTools.Easing                                                                                                                                                                                           |
| Release the whole game under the same terms | GPL and AGPL libraries: none recommended; they appear only among developer tools                                                                                                                                                                                                                                                                                                                            |
| Pay, or buy a separate licence              | BASS: free only for non-commercial use, otherwise €125 to €3,450 per platform ([BASS][bass]). Six Labors ImageSharp and Fonts: Apache-2.0 terms under US$1M revenue or for open source, a commercial licence above, and a licence key required at build time for direct references ([Split License][sixlabors-license]). Spine's runtimes: every user needs a Spine Editor licence ([Spine][spine-license]) |
| Agree to the platform's terms               | Valve's Steamworks SDK: ship only the `redistributable_bin` files ([SDK agreement][steamworks-redist]). Microsoft's D3D12 Agility SDK, which `fnalibs` includes for Windows: distributors must agree to terms "that protect it and Microsoft at least as much as this agreement" ([package][agility-sdk])                                                                                                   |
| Other restrictions                          | LeoECS's MIT-Red restricts who may use it; EcsProto's MIT-ZARYA requires a Russian localisation; Triangle.NET allows commercial use only "BY DIRECT ARRANGEMENT WITH THE AUTHOR"                                                                                                                                                                                                                            |

- **OpenAL Soft (Documented, Observed).** It is "either version 2 of the License, or (at your option) any later version" of the LGPL ([alc.cpp][oal-alc]). A game that ships it must "give prominent notice with each copy of the work that the Library is used in it", "supply a copy of this License", offer the library's complete source, and permit "reverse engineering for debugging such modifications"; and "if the work during execution displays copyright notices, you must include the copyright notice for the Library among them" ([LGPL-2.1 §6][lgpl21]). That last duty applies only to a game that shows copyright notices while it runs. MonoGame's `MonoGame.Library.OpenAL` package holds only a BSD-3 portion of the licence, while MonoGame's own notices say `LGPL-2.1-or-later` ([THIRD-PARTY-NOTICES][mg-notices]), so a MonoGame export must add the LGPL text itself.
- **LGPL and NativeAOT (Documented, Inference).** A default NativeAOT build still loads `libopenal` as a separate file, which is dynamic linking. Linking it statically through `DirectPInvoke` and a static archive would oblige the game to ship its own object files so that players can relink ([NativeAOT interop][aot-interop], [LGPL-2.1 §6(a)][lgpl21]). Managed LGPL assemblies compiled into a NativeAOT executable are linked statically. So native LGPL code stays in shared libraries, and managed LGPL assemblies stay out of NativeAOT builds.
- **Developer tools (Documented).** These ship nothing in the game but bind the people who use them: FluentAssertions 8 needs a paid licence per developer to test a game that is sold ([LICENSE][fluentassertions-license]); Verify 33 asks a maintenance fee of organisations above US$10,000 revenue and fails the build without a declaration, while 32.0.1 is fee-free ([fee][verify-fee]); MSTest's NativeAOT generator is under Microsoft's Testing Platform Tools terms; Microsoft's `vsdbg` may be used only in Microsoft's own editors ([licence][vsdbg-license]).
- **Visible credit (Documented).** Several engines, frameworks and middleware libraries were set aside because their licences require a logo before play, a line in the credits or a notice shown to players. They are not named in this note. Credits in documentation, such as FreeType's, are not counted as visible.

## Agents

- **Training data ends before the current releases (Observed).** From memory, neither agent named a release after 2025, against current releases from 2026 for most libraries ([above](#what-codex-and-claude-wrote)). A skill must give the version and interface the game uses, and tell the agent to check the game's project files and NuGet before naming one (**Inference**).
- **Libraries that refuse AI-written contributions (Documented).** MonoGame (from 2026-04-20), SDL (2026-04-15), FNA and FNA's SDL3# binding (2026-07-07), FAudio, MonoGame.Extended (2026-10-08), Silk.NET (2026-10-15) and the Murder engine forbid issues, comments or patches written by AI ([MonoGame][mg-agents], [SDL][sdl-agents], [FNA][fna-agents], [Silk.NET][silk-agents], [MonoGame.Extended][mge-agents]). xUnit's repository asks AI tools not to read its source at all ([ai.txt][xunit-ai]). Agents may use these libraries, but a report upstream must come from the person; the agent gives them the facts (**Inference**).
- **Documentation for agents (Observed).** Few libraries publish an `llms.txt`: Arch, Friflo.Engine.ECS, StaticEcs, TUnit, Gum and Yarn Spinner among those checked ([Arch][arch-llms], [TUnit][tunit-llms]); MonoGame, FNA, raylib, SDL and Silk.NET do not. Gum ships agent skills ([CLAUDE.md][gum-claude]), Verify publishes a skill template ([AI usage][verify-ai]), and Myra an MCP server ([Myra.Mcp][myra-mcp]). FNA asks people not to use third-party documentation ([FAQ][fna-faq]).
- **How often interfaces break (Documented).** XNA's interface itself is stable in MonoGame and FNA, but every MonoGame release since 2024 changed project files, tools or content ([release notes][mg-386]). Elsewhere, fast churn is common: Gum noted breaking changes in 31 of 42 releases since 2024, MonoGame.Extended made three major versions since mid-2024, xUnit four since December 2024, Verify eleven since 2024 and FixedMathSharp six in 2026 ([Gum][gum], [xUnit][xunit-400]).
- **What a skill must teach (Inference).** The versions in use, and how to check them live; the replay rules above, as lists that a source check enforces, such as a banned-API analyser in the simulation project; the floating-point operations that are safe, so agents do not turn to fixed point needlessly; MonoGame's interface without the MonoGame-only additions when the game uses FNA; drawing without vsync in preview and agent runs; how to stop a run; content without the Windows-only effect compiler; the licence duties each library brings; and each library's policy on AI-written contributions.

## The catalogue

One table per area. Each row gives the library and its owner, what it is for, its latest release and, where counted, its activity in commits over the last 90 days, how it reaches the six desktops and NativeAOT, what its licence asks of a game that ships it, and a verdict with the main reason. Facts are **Documented** in each library's repository or package, or **Observed** in its package; verdicts are **Inference**. "Six" means native libraries for all six desktops; "managed" means none are needed. Libraries whose licences require visible credit are left out.

### Frameworks and engines

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [MonoGame DesktopGL][c-monogame] (MonoGame Foundation) | XNA framework on SDL 2, OpenGL and OpenAL Soft | 3.8.6 (2026-10-07); 55 | Six; glibc 2.34; `IsAotCompatible`, though content readers with generic collections can fail under AOT; no Retina on macOS | Ms-PL and MIT notices; OpenAL Soft's LGPL | **Recommend** for 0.1; draw without vsync off screen |
| [MonoGame native backends][c-monogame-native] | The same interface on Vulkan, Direct3D 12 or OpenGL 4.1, with SDL 2 and FAudio inside one native library | 3.8.6; new in 3.8.5 and 3.8.6 | Six; MoltenVK on macOS | Ms-PL, MIT, zlib; add MoltenVK's and SPIRV-Cross's Apache notices, which MonoGame omits | **Consider** after 0.1: no LGPL, and Vulkan and Direct3D 12 shaders compile without Wine; young, with resize faults |
| [MonoGame WindowsDX][c-monogame-windowsdx] | XNA framework on Direct3D 11 | 3.8.6 | Windows only; archived SharpDX; no AOT | Ms-PL, MIT | **Avoid**: Windows only |
| [FNA][c-fna], FNA3D, FAudio (FNA-XNA, Ethan Lee) | Accurate XNA 4 on SDL3, SDL_GPU and FAudio | 26.10 (2026-10-01); 235; monthly | Five: no Windows arm64; added as source, with natives only from expiring daily builds; NativeAOT documented | Ms-PL and MIT notices; zlib natives; Microsoft's Agility SDK terms if `D3D12Core.dll` ships | **Consider**: the strongest alternative; keep a copy of the natives and build Windows arm64's |
| [KNI][c-kni] (Nikos Kastellanos) | MonoGame derivative with a Blazor web target | 4.3.9001 (2026-08-22); 61 | No Windows or Linux arm64; SDL 2.0.20 on Windows; Windows-only content builder | Ms-PL, MIT; OpenAL Soft's LGPL | **Avoid** on desktops |
| [Foster][c-foster] (Noel Berry) | Small 2D framework on SDL3 and SDL_GPU | 0.4.2 (2026-08-27); 48 | No Windows arm64; `net10.0`; `IsAotCompatible`; `GetData` stalls the GPU | MIT; the OFL notice for its Roboto font | **Consider** for 2D: the game adds audio, a Windows arm64 SDL3 and a fenced read-back |
| [SadConsole][c-sadconsole] (Thraka) | Text-mode games on MonoGame, FNA or SFML | 10.10.1 (2026-05-30); 3 | Through its host | MIT | **Consider** for text-mode games |
| [osu-framework][c-osu-framework] (ppy) | Framework with its own scene model | 2026.1008.0; 87 | BASS, SDL3 and a Veldrid fork whose SPIR-V package lacks Windows and Linux arm64 | MIT, but BASS needs a paid licence for sold games | **Avoid** |
| [Nez][c-nez] (prime31) | MonoGame or FNA add-on with its own scene model | 0.10.0 (2019); 0 | Old targets | MIT | **Avoid**: barely maintained |
| Stride, Godot, Murder, FlatRedBall, Prowl, s&box, RobustToolbox | Engines with an editor, a scene model or their own build | – | – | Mostly MIT | **Excluded** by ADR 0004 |
| Duality, Velaptor, Ultraviolet, Otter, Monofoxe, Wobble | Small or unmaintained frameworks | 2018–2026 | – | MIT | **Avoid** |

### Windowing, input and graphics bindings

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [SDL3][c-sdl3] (libsdl-org) | Window, input, audio, GPU (Vulkan, Direct3D 12, Metal), 2D renderer | 3.4.18 (2026-10-02); 420 | Through its bindings | zlib | **Recommend** as the low-level foundation |
| [SDL3-CS][c-sdl3cs] (Eduard Gushchin) | SDL3 with SDL_image, SDL_ttf, SDL_mixer and shadercross | 3.4.18 (2026-10-03); 156 | Six, stable SDL; `LibraryImport` | zlib; LGPL codecs as separate libraries | **Recommend**; one maintainer, and functions renamed in C# style |
| [ppy.SDL3-CS][c-ppy-sdl3] (ppy) | SDL3 family, used by osu! | 2026.1002.1 (2026-10-02); 11 | Six and phones; ships an SDL 3.5.0 development build | MIT; zlib | **Consider** with stable SDL natives |
| [SDL3#][c-sdl3sharp] (Ethan Lee, Colin Jackson) | SDL3 binding as source, FNA's | `main` 2026-07-07; 0 | Natives supplied by the game | zlib | **Recommend** to copy as source; refuses AI-written patches |
| [Hexa.NET.SDL3][c-hexa-sdl3], .GLFW, .Raylib (Juna Meinhold) | Generated bindings | 1.2.17 (2026-01-28); .GLFW 1.0.5, .Raylib 1.2.2; 0 | Six; function-pointer tables | MIT | **Consider** beside Hexa.NET.ImGui, or .Raylib for raylib 6.0 natives on all six |
| [Raylib-cs][c-raylibcs] (raylib-cs) | raylib 6.0: window, input, 2D and 3D drawing, audio, text | 8.1.0 (2026-09-05); 18; "passively maintained" | Four, plus raylib's own arm64 builds; fails with no display | zlib, raylib's MIT notices | **Consider** for prototypes; not for runs without a display, where it cannot start |
| [Raylib-CSharp][c-raylib-csharp] (MrScautHD) | raylib 5.5 | 5.0.0 (2025-05-04); 0 | No Windows or Linux arm64 | MIT | **Avoid** |
| [Silk.NET][c-silk] (.NET Foundation) | Bindings for GLFW, SDL 2, OpenGL, Vulkan, WebGPU, OpenAL, Assimp, with natives | 2.23.0 (2026-01-22); 15; 3.0 unreleased | Six; platforms registered by hand under AOT | MIT; OpenAL Soft's LGPL | **Consider** its bindings and natives; **avoid** as a foundation |
| [OpenTK][c-opentk] (Team OpenTK) | OpenGL, GLFW and OpenAL bindings, maths | 4.9.4 (2025-03-17); 24; 5.0 in preview | GLFW without Windows or Linux arm64 | MIT | **Avoid** |
| [SFML.Net][c-sfml] (SFML team) | Window, input, 2D, audio | 3.0.0 (2026-01-19); 0 | Six | zlib; FreeType credit in documentation | **Avoid**: inactive; reads the real keyboard |
| [Veldrid][c-veldrid]; NeoVeldrid, Veldrith | GPU abstraction; forks | 4.9.0 (2023); 1.2.x (2026) | Veldrid's SPIR-V tools lack arm64 | MIT | **Avoid** Veldrid; **consider** NeoVeldrid if Veldrid's interface is wanted; **watch** Veldrith |
| Sokol.NET; bgfx bindings | Graphics layers | No package; Bgfx.Net 0.7.0 | Missing desktops | MIT; BSD-2 | **Avoid** for now |

### Graphics APIs, 2D rendering and shaders

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Vortice.Vulkan][c-vortice-vulkan] (Amer Koleci) | Vulkan, VMA and SPIR-V bindings | 3.3.0 (2026-09-29); 5 | System loader | MIT | **Recommend** for Vulkan |
| [Silk.NET.Vulkan][c-silk], SwiftShader and MoltenVK packages | Vulkan, a CPU Vulkan driver, Vulkan on Metal | 2.23.0; 2025 | Six (MoltenVK on macOS) | MIT; Apache notices | **Consider**; SwiftShader for headless CI |
| [Vortice.Windows][c-vortice-windows], TerraFX.Interop | Direct3D 11 and 12, DXGI | 3.8.3 (2026-03-04); 6 | Windows; `IsAotCompatible` | MIT | **Consider** on Windows |
| [SharpDX][c-sharpdx] | Direct3D | 4.2.0 (2018); archived | Windows | MIT | **Avoid** |
| [SharpMetal][c-sharpmetal] (Isaac Marovitz) | Metal | 1.1.0 (2025-11-02); 0 | System Metal | MIT | **Consider** for a Metal backend |
| [WebGPUSharp][c-webgpusharp] (Emil SV), on Dawn; Alimer.Bindings.WebGPU, Silk.NET.WebGPU (wgpu) | WebGPU | 0.5.8 (2026-10-16); 1.6.0; 2.23.0 | Six | MIT; Dawn BSD-3; wgpu MIT or Apache | **Consider** |
| [SkiaSharp][c-skiasharp] (Microsoft) | 2D vector and raster drawing, text, codecs, Lottie | 4.153.1 (2026-09-30); 229 | Six and more | MIT and notices; IJG and FreeType credits in documentation | **Consider** for 2D extras and tools |
| [Slang][c-slang] (Khronos), with SlangShaderSharp or Slangc.NET | Shader compiler, run offline | v2026.20 (2026-10-17); 491 | Six | Apache-2.0 with LLVM exception; a tool only | **Recommend** for custom shaders, after 0.1 |
| [SDL_shadercross][c-shadercross] (libsdl-org) | HLSL or SPIR-V into SDL_GPU's formats | No release; 1 | Six, through SDL3-CS's packages | zlib; vkd3d LGPL inside | **Consider** offline |
| [DXC][c-dxc] (Microsoft), as MonoGame.Tool.Dxc or Vortice.Dxc | HLSL compiler | v1.9.2609 (2026-09-29); 174 | MonoGame's package: six | NCSA or MIT when built from source; Microsoft's terms for its own binaries | **Consider** as a build tool |
| MonoGame's MGFXC | MonoGame's `.fx` effect compiler | 3.8.6 | Needs Wine on macOS and Linux for DesktopGL | Ms-PL | **Avoid** in 0.1, as the [roadmap][roadmap-versions] says |
| ShaderGen; ComputeSharp | C# as a shader language | 2019 beta; 3.2.0 (Windows) | – | MIT | **Avoid** |

### Native interop and binding generators

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence | Verdict |
| --- | --- | --- | --- | --- | --- |
| `LibraryImport` (.NET) | Source-generated P/Invoke | .NET 10 | All; works with `DisableRuntimeMarshalling` | MIT | **Recommend** for any binding a game writes |
| [ClangSharp][c-clangsharp] (.NET Foundation) | Generates bindings from C headers | 21.1.8.4 (2026-07-15); 32 | Tool; blittable output | MIT | **Recommend** |
| [c2cs][c-c2cs], [HexaGen][c-hexagen] | Generators | 2026.4.27; 1.1.24.1 | Tool | MIT | **Consider** |
| [CppSharp][c-cppsharp] (mono) | C++ bindings | 1.1.84 (2025-11-19); 0 | Tool | MIT | **Avoid** for C libraries |
| [CsWin32][c-cswin32] (Microsoft) | Win32 projection | 0.3.363 (2026-10-14); 63 | Windows; AOT through `LibraryImport` | MIT | **Consider** for Windows-only helpers |

### Audio

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [miniaudio][c-miniaudio] (David Reid), through [Hexa.NET.MiniAudio][c-hexa-miniaudio] or [MiniAudioExNET][c-miniaudioex] | Devices, decoding, mixing, 3D; renders sound on request, with no device | 0.11.25 (2026-03-03); bindings 1.0.1 and 3.3.7 | Six; Hexa's binding `IsAotCompatible`, MiniAudioExNET's AOT **Unconfirmed**, since it has no AOT marker | miniaudio: public domain or MIT-0; the bindings: MIT notices | **Recommend** miniaudio where sound must render offline; both bindings are young: Hexa's has one maintainer and no commits since March, and MiniAudioExNET renders offline only through its native interface |
| [SDL3 audio][c-sdl3] and [SDL3_mixer 3][c-sdl3-mixer] | Audio streams; a mixer that renders on request | 3.4.18; mixer 3.2.4 (2026-06-03) | Six, through ppy's or Gushchin's packages | zlib and codec licences; ppy's mixer build contains LGPL libgme and TiMidity's Artistic licence; Gushchin's loads libgme and mpg123 as separate files | **Recommend** in SDL3 stacks, ideally with SDL3_mixer built without libgme |
| MonoGame audio, on [OpenAL Soft][c-openal-soft] | `SoundEffect` and `Song` | 3.8.6 | Six | Ms-PL plus OpenAL Soft's LGPL; MonoGame.Library.OpenAL 1.24.3.4 holds only a BSD-3 portion of the licence (**Observed**) | **Consider** for live play; no offline rendering |
| [FAudio][c-faudio] (FNA-XNA) | XAudio2 reimplementation, FNA's audio | 26.10 (2026-10-01); 25 | Five: no Windows arm64 | zlib | **Recommend** within FNA; offline rendering **Unconfirmed**, as it was not run |
| [Theorafile][c-theorafile] (FNA-XNA) | Ogg Theora video, FNA's | untagged (2026-07-07) | Five, through FNA's natives | zlib; BSD notices for libogg, libvorbis and libtheora in documentation | **Recommend** for cutscenes in FNA |
| [Silk.NET.OpenAL][c-silk] and OpenAL Soft natives | OpenAL binding and natives | 2.23.0; natives 1.23.1 (2024-04-23) | Six | MIT plus LGPL natives, shipped without the licence text | **Consider** in Silk.NET stacks, with a hand-written loopback call; **avoid** otherwise |
| [SoLoud][c-soloud] with SoLoudSharp | Engine with a null driver | 20200207; 0.3.1 (2026-10-01) | x64 only in the binding | zlib | **Consider** if built for arm64 |
| [NAudio 3][c-naudio] (Mark Heath) | Managed audio toolkit: WAV, DSP | 3.2.0 (2026-10-15); 69 | Managed core | MIT | **Consider** for tools and DSP |
| [ManagedBass][c-managedbass] with BASS (un4seen) | BASS bindings | 4.0.2 (2025-10-03); BASS 2.4.18.3 | Six | Free only for non-commercial use; €125 to €3,450 per platform | **Consider** only if the fee is acceptable |
| [Steam Audio][c-steamaudio] with SteamAudio.NET | Spatial audio | 4.8.1 (2026-02-11) | x64 only; non-standard macOS RID | Apache-2.0 and notices | **Consider** for 3D games on x64 |
| [NVorbis][c-nvorbis]; [NLayer][c-nlayer]; [Concentus][c-concentus] | Vorbis, MP3 and Opus decoders | 0.10.5; 3.0.0 (2026-08-27); 2.2.2 | Managed | MIT; MIT; BSD-style | **Recommend** |
| [FFMpegCore][c-ffmpegcore] | Calls the `ffmpeg` command line | 5.5.0 (2026-09-20); 45 | Managed; FFmpeg supplied separately | MIT; FFmpeg's terms fall on whoever ships FFmpeg | **Recommend** for encoding gameplay video in Playstead, not in games |
| SoundFlow; SharpAudio; MP3Sharp; LibVLCSharp; Sdcb.FFmpeg | Engines, decoders, video | 2019–2026 | Mixed | MIT; MIT; LGPL-3.0; LGPL-2.1+; LGPL-3.0 and GPL | **Avoid**: paused until 2027, stale, or copyleft |

### Text and fonts

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [FontStashSharp][c-fontstashsharp] (FontStashSharpTeam) | Text with dynamic atlases, BMFont and SDF; an optional HarfBuzz shaper, which pins HarfBuzzSharp 8.3.1.2; simple right-to-left | 1.6.2 (2026-10-17); 126 | Managed, on MonoGame, FNA, KNI and others | zlib, with MIT notices | **Recommend** |
| [StbTrueTypeSharp][c-stbtruetype] (StbSharp) | TrueType rasteriser | 1.26.13 (2026-08-08); 2 | Managed | Unlicense or MIT | **Recommend** |
| [HarfBuzzSharp][c-harfbuzzsharp] (Microsoft) | Shaping for writing systems that need it; right-to-left ordering and line breaking stay with the game | 14.2.1.301 (2026-09-30); 229 | Six, with the Linux package added | Old MIT notice | **Recommend** where scripts need shaping |
| [SDL3_ttf][c-sdl3-ttf] | Fonts with HarfBuzz, SDF and GPU text | 3.2.2 (2025-03-31); 4 | Six, through ppy's package | zlib, FreeType credit in documentation, HarfBuzz notice | **Recommend** in SDL3 stacks |
| [msdfgen][c-msdfgen] and msdf-atlas-gen | Multi-channel distance-field atlases | v1.13; v1.4 (2026-03-05) | Build tool | MIT; not shipped | **Recommend** at build time |
| [SharpFNT][c-sharpfnt] | BMFont files | 2.0.0 (2020); stable format | Managed | MIT | **Recommend** |
| [FreeTypeSharp][c-freetypesharp]; MonoGame.Library.FreeType | FreeType binding and natives | 3.1.0 (2026-02-06); 2.13.2.5 | No linux-arm64 in FreeTypeSharp; MonoGame's: six | FreeType credit in documentation | **Consider** |
| MonoGame's SpriteFont pipeline | Fonts baked at build time | 3.8.6 | Build tool | Ms-PL; FreeType not shipped | **Consider** for fixed character sets |
| [SixLabors.Fonts][c-sixlabors-fonts] | Managed fonts and shaping | 3.2.0 (2026-10-09); 156 | Managed | Split License, a build-time key, FreeType credit | **Avoid** as a direct dependency |
| SpriteFontPlus; SharpFont; Typography | Older font libraries | 2016–2023 | – | MIT | **Avoid**: superseded or idle |

### Images and textures

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [StbImageSharp][c-stbimage], StbImageWriteSharp | PNG, JPEG, TGA, BMP and HDR in and out | 2.30.16 (2026-08-08); 8 | Managed | Unlicense, MIT or public domain | **Recommend** |
| [Pfim][c-pfim] (Nick Babcock) | DDS and TGA | 0.11.4 (2025-11-29) | Managed | MIT | **Recommend** |
| [BCnEncoder.Net][c-bcnencoder] | BC1 to BC7, KTX and DDS | 2.3.0 (2026-03-05) | Managed | MIT or Unlicense | **Recommend** at build time |
| [LibKTX][c-libktx] | KTX 1 and 2 reader | 1.0.0 (2026-05-08) | Managed; `IsAotCompatible` | Unlicense | **Recommend** |
| [basisu][c-basisu], as MonoGame.Tool.Basisu | Basis Universal encoder | v2_50 (2026-08-03) | Tool for six | Apache-2.0; not shipped | **Recommend** at build time; decoding Basis or Zstandard KTX 2 in the game needs a binding such as BasisUniversal.NET 1.0.0, which is very new |
| SDL3_image, through ppy's package | Image loading | 2026 | Six; Linux needs `libjbig.so.0` | zlib, libpng, libtiff and libwebp notices | **Consider** in SDL3 stacks |
| [Imazen.WebP][c-webp] | libwebp binding | 11.0.0 (2026-02-27); 7 | Six | MIT; libwebp BSD notice | **Consider** |
| Packers: RectpackSharp, StbRectPackSharp, myratexpack | Texture atlas packing | 2021–2026 | Managed | MIT or public domain | **Consider** at build time |
| [SixLabors.ImageSharp][c-imagesharp] | Managed imaging | 4.1.3 (2026-10-09); 883 | Managed | Split License; a build-time key | **Avoid** as a direct dependency |

### Content formats

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [DotTiled][c-dottiled] (Daniel Cronqvist) | Tiled maps | 1.0.0 (2025-10-28) | Managed | MIT | **Recommend** |
| [TiledLib][c-tiledlib] (Daniel Sör) | Tiled maps, with a MonoGame pipeline | 5.3.0 (2026-05-30) | Managed; `XmlSerializer` needs care under trimming and AOT | MIT | **Consider** |
| [LDtkMonogame][c-ldtkmonogame]; LDtk's QuickType types | LDtk levels | 1.8.3 (2026-10-16); the LDtk editor's last release is 1.5.3 (2024-01-15) | Managed | MIT | **Recommend** with MonoGame, though the editor is quiet; **consider** the types, regenerated for System.Text.Json, elsewhere |
| [AsepriteDotNet][c-asepritedotnet]; [MonoGame.Aseprite][c-monogame-aseprite] (Christopher Whitley) | Aseprite files; sprite animation in MonoGame | 1.9.1; 6.4.1 (2026-10-08) | Managed | MIT | **Recommend** |
| [SharpGLTF][c-sharpgltf] (Vicente Penades) | glTF 2.0 in and out | 1.0.7 (2026-09-12); 8 | Managed; `IsAotCompatible` | MIT | **Recommend** for 3D, later |
| [AssimpNetter][c-assimpnetter] | Assimp, many 3D formats | 6.0.5 (2026-06-23) | Six | MIT; Assimp BSD notice if shipped | **Recommend** in build tools only |
| MonoGame.Extended's readers | Tiled, LDtk, Ogmo, BMFont, TexturePacker in MonoGame | 6.1.1 | Managed | MIT | **Consider** with MonoGame |
| TiledCS, TiledSharp; AssimpNet, SharpAssimp; Ogmo readers | Older or narrower readers | 2018–2025 | Mixed | MIT or Apache-2.0 | **Avoid**: idle, x64-only or missing desktops |

### Physics

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Box2D.NET][c-box2dnet] (ikpil) | Pure C# port of Box2D 3.1 | 3.1.654 (2026-02-28); 18 | Managed | MIT | **Recommend** for 2D; replay across x64 and arm64 follows from its plain maths but is untested, so port Box2D's determinism test first; no snapshots yet |
| Native Box2D 3.1 bindings, such as HughPH.Box2D | Box2D in C | 2025–2026 | Varies | MIT | **Avoid** for replay: fused instructions in arm64 builds; **consider** HughPH.Box2D only with natives rebuilt from Box2D's main branch, the one route to snapshots |
| [Aether.Physics2D][c-aether] (nkast); Velcro Physics | Farseer-derived 2D physics | 2.2.0 (2025-03-21); 2021 | Managed | Ms-PL; MIT | **Avoid** for replay |
| [Jitter Physics 2][c-jitter2] | 3D physics with a deterministic mode | 2.10.1 (2026-10-15); 126 | Managed | MIT | **Consider** for 3D, later: cross-platform replay claimed, no snapshots |
| [BEPUphysics v2][c-bepu] | Fast 3D physics | 2.5.0-beta.33 (2026-10-11); 7 | Managed | Apache-2.0 | **Avoid** for replay: same-machine determinism only |
| [JoltPhysicsSharp][c-joltsharp] (Amer Koleci) | Jolt bindings | 2.23.0 (2026-10-05); 3 | Six; the win-x64 native needs AVX2 | MIT | **Avoid** for replay: natives built without Jolt's deterministic option |
| MagicPhysX; BulletSharp | PhysX and Bullet bindings | Archived; 0.11 (2018) | – | MIT; BulletSharp's **Unconfirmed**, as no licence was found | **Avoid** |
| Collision written in the game | Boxes against tiles | – | – | – | **Recommend** for platformers and puzzle games; Humper's source is a model for boxes on grids |

### Maths and fixed point

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| `System.Numerics` and `Math` (.NET 10) | Vectors, matrices, maths functions | 10.0.13 (2026-10-13) | All | MIT, in .NET; runtime notices when self-contained | **Recommend** with the [simulation's rules](#the-sealed-simulation) |
| The frameworks' types (MonoGame, FNA) | `Vector2`, `Matrix`, `MathHelper` | with each framework | All | The framework's | **Consider**: plain scalar code, but the rotation and slerp helpers call the C runtime |
| [FixedMathSharp][c-fixedmathsharp] | 64-bit fixed point | 7.1.0 (2026-08-23); 63; six majors in 2026 | Managed | MIT, with its NOTICE file | **Consider** where a game wants no floating point |
| [FixPointCS][c-fixpointcs] (XMunkki) | Fixed point in C#, Java and C++ | v0.3 (2022-03-26); low | Managed; no NuGet package | MIT | **Consider** as code copied into the simulation |
| [CoreMathSharp][c-coremathsharp] (andanteyk) | Correctly rounded `float` and `double` functions | 1.0.0 (2026-02-06); quiet since | Managed | MIT, with CORE-MATH and musl notices | **Consider**, pinned and with golden tests: it would make trigonometry safe in the simulation |
| Silk.NET.Maths; GlmSharp; Raylib-cs's Raymath | Generic, GLM-style or native maths | 2.23.0; 0.9.8 (2016); 8.1.0 | Managed; managed; native, without Windows or Linux arm64 | MIT; zlib | **Avoid** in the simulation: Silk.NET.Maths's transcendental functions, GlmSharp, and Raymath, which is fused on arm64 |

### UI: in-game, tools and separate windows

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Gum][c-gum] (Victor Chelaru) | Player-facing UI and its editor, on MonoGame, KNI, FNA, raylib, Silk.NET | 2026.10.1.1 (2026-10-01); 1,355 | Managed; not marked AOT-compatible, and its XML loading uses `XmlSerializer`; ships agent skills and `llms.txt` | MIT, plus its dependencies' notices | **Recommend**; expect breaking releases |
| [Hexa.NET.ImGui][c-hexa-imgui] (Juna Meinhold) | Dear ImGui with ImPlot, ImGuizmo, ImNodes and backends | 2.2.9 (2025-10-10); 13 | Six; needs the Visual C++ runtime; Windows arm64 fault ([Hexa.NET.ImGui#90][hexa-imgui-90]) | MIT; FreeType's documentation credit, since cimgui includes it | **Recommend** for development-build tools |
| [ImGui.NET][c-imgui-net] | Dear ImGui binding | 1.91.6.1 (2025-01-06); 2 | No linux-arm64; open Windows arm64 fault ([ImGui.NET#508][imgui-net-508]) | MIT | **Consider**: best known, but stale |
| [Myra][c-myra] (Roman Shapiro) | Retained UI with XML layouts | 1.6.7 (2026-10-05); 140 | Managed; layouts load by reflection and may break when trimmed | MIT | **Consider**: reads the wall clock |
| [Apos.Gui][c-apos-gui] | Immediate-mode UI | 3.0.0 (2026-10-11); 38 | Managed; `net10.0`; depends on MonoGame.Extended 5 | MIT | **Consider** where headless UI tests matter |
| MLEM.Ui; Iguina | UI libraries | 8.1.0; 1.1.8 | Managed; MLEM.Ui reads devices itself; Iguina's stylesheets fail under NativeAOT | MIT | **Consider** for UI that Playstead never drives |
| [Avalonia][c-avalonia] | Separate tool windows | 12.1.4 (2026-10-09); 278 | Six through SkiaSharp 3, so not in a process with SkiaSharp 4; AOT documented | MIT core; paid add-ons | **Consider** for tools outside the game |
| Eto.Forms | Native-widget tool windows | 2.13.0 | Platform toolkits; GTK on Linux | BSD-3 | **Consider** where native widgets matter |
| Uno Platform | XAML tool windows | 6.7.30 | SkiaSharp and others | Apache-2.0 | **Consider** for large tools |
| GeonBit.UI; EmptyKeys; Clay and RmlUi bindings | Older or immature UI | 2020–2026 | Gaps | MIT; Clay ports zlib or BSD-3 | **Avoid** |

### Animation, tweening and particles

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [MonoGame.Aseprite][c-monogame-aseprite] | Sprite animation from Aseprite files | 6.4.1 (2026-10-08) | Managed | MIT | **Recommend** with MonoGame |
| [MonoGame.Extended][c-monogame-extended] | Tweens, particles, cameras, readers | 6.1.1 (2026-08-18); 16 | Managed; tweening uses `Expression.Compile` | MIT | **Consider** module by module: its content pipeline fails on MonoGame 3.8.6 until 6.2.0; particles need a local patch to seed each effect; refuses AI-written contributions |
| [Apos.Tweens][c-apos-tweens] | Tweens driven by the game's time | 0.2.0 (2026-01-07) | Managed | MIT | **Consider**: replays if the game drives its clock from ticks; one clock per process |
| A tween type of the game's own | Tweens advanced by ticks | – | – | – | **Recommend**: presentation reads ticks, not the clock |
| [Spine runtimes][c-spine] (Esoteric Software) | Skeletal animation | No C# releases; 4.3 branch (2026-10-12) | Managed source | Each user needs a Spine Editor licence, Essential and Professional only under US$500,000 revenue; include the Spine Runtimes License in the game's documentation | **Consider** only for people with licences |
| [SkiaSharp.Skottie][c-skiasharp] | Lottie animations | 4.153.1 | Six, with Linux natives added and linux-x64 needing libfontconfig; SkiaSharp 4, so not beside Avalonia | MIT and notices | **Consider** |
| DragonBones; SpriterDotNet; Rive's C# runtime | Skeletal or vector animation | 2017–2025 | Dead or Windows only | MIT; zlib | **Avoid** |
| Glide; Pleasing; GTweens; MoonTools.Easing | Tweens and easing | 2015–2024 | – | MIT; LGPL-3.0 (MoonTools.Easing) | **Avoid**: abandoned, a test runner as a run-time dependency (GTweens), or LGPL under NativeAOT |
| Nez particles; Mercury; NeutrinoParticles | Particles | 2015–2026 | – | MIT (Nez); unstated (Mercury); subscription (Neutrino) | **Avoid** |

### Entity systems

| Library (owner) | For | Latest; activity | AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| The game's own arrays of structs | State indexed by id and generation | – | Yes | – | **Recommend** for small and medium games |
| [StaticEcs][c-staticecs] (Felid Force Studios) | Bitmap ECS that can snapshot the whole world | 2.2.9 on GitHub (2026-07-11), which changed the snapshot format; 2.2.8 on NuGet; 2 | Managed; `net10.0`; register types by hand | MIT | **Consider**: the lead ECS candidate, after an AOT trial and a check that a restored world hands out the same ids; one live world per world type; `llms.txt` and an agent guide |
| [Friflo.Engine.ECS][c-friflo] (friflo) | Archetype ECS with JSON serialisation | 3.6.0 (2026-03-23); 5 | Managed; explicit AOT registration | MIT | **Consider** |
| [MoonTools.ECS][c-moontools-ecs] (Moonside Games) | Small ECS with in-memory snapshots | `main` 2026-04-18 | Managed; copied as source | zlib | **Consider** for small games |
| Svelto.ECS; fennecs; TinyEcs; Myriad.ECS | Other ECS designs | 2024–2026 | Svelto relies on reflection and Myriad on `MakeGenericMethod`; fennecs and Myriad need an AOT trial; TinyEcs's NuGet ID belongs to another project, so pin a commit | MIT; Svelto also Apache-2.0 for one file | **Consider** with care |
| Paradise.ECS; Frent | Deterministic-by-design or hybrid ECS | 2026; 2024–2026 | Managed; `net10.0`; Frent's AOT claim **Unconfirmed**, as it was not tried | MIT | **Watch**: Paradise is months old; Frent is in beta, with ids shared across the process and module initialisers that Hot Reload does not rerun |
| [Arch][c-arch] (genaray) | Archetype ECS | 2.1.0 (2025-05-27); 2 | Managed; "mostly" AOT | Apache-2.0 | **Avoid** until a release ships the fixes merged on 2026-10-17 for run-dependent archetype collisions ([#303][arch-303]) and reused live ids ([#315][arch-315]) |
| MonoGame.Extended's ECS | ECS inside MonoGame.Extended | 6.1.1 | Managed | MIT; a BSD-2-style notice in documentation | **Avoid**: components are classes, ids have no generations, and it ties the simulation to MonoGame |
| Massive; Flecs.NET; DefaultEcs; Entitas; Morpeh; DragonECS; LeoECS | Other ECS libraries | 2022–2026 | Mixed | MIT or MIT-0; restricted (LeoECS) | **Avoid**: paused, stalled, unmaintained, made for another engine first, or with reads that change order |

### Collections, memory and jobs

| Library (owner) | For | Latest; activity | AOT | Licence | Verdict |
| --- | --- | --- | --- | --- | --- |
| .NET's collections, with `OrderedDictionary<TKey,TValue>` | Ordered keyed state | .NET 10 | Yes | MIT | **Recommend**; never iterate `Dictionary`, `HashSet`, frozen or concurrent collections in the rules, and give string keys ordinal comparers |
| `System.IO.Hashing` (`XxHash128`, `XxHash3`) | Fingerprints | 10.0.13 | Yes | MIT | **Recommend** |
| `ArrayPool<T>`, `ObjectPool` | Scratch buffers outside the state root | .NET 10 | Yes | MIT | **Recommend** |
| [CommunityToolkit.HighPerformance][c-communitytoolkit] (.NET Foundation) | Spans in two dimensions, pooled buffers | 8.4.2 (2026-03-25); 0 | Trimmable | MIT | **Consider**; an open .NET 10 regression makes the compiler pick its span extensions over the runtime's ([#1138][communitytoolkit-1138]) |
| [ZLinq][c-zlinq] (Cysharp) | Allocation-free LINQ | 1.5.6 (2026-04-08); 4 | Trimmable | MIT | **Consider** outside the simulation: SIMD `double` sums differ by machine; never its drop-in generator, which reroutes `Sum` silently |
| Task Parallel Library | Parallel work | .NET 10 | Yes | MIT | **Recommend** with fixed partitions and an ordered merge; no PLINQ or TPL reductions in the rules |
| ZeroAllocJobScheduler; Collections.Pooled; Misaki.HighPerformance.Jobs | Job systems and pooled collections | 2019–2026 | Mixed | MIT, Apache | **Avoid**: timing-dependent, unmaintained, or new and little used (Misaki) |

### Serialisation and saves

| Library (owner) | For | Latest; activity | AOT | Licence | Verdict |
| --- | --- | --- | --- | --- | --- |
| System.Text.Json (.NET) | Saves, settings, content, the description of the game state | 10.0.13 | Source generation; `IsAotCompatible` | MIT | **Recommend**, with a version header and migrations |
| [protobuf-net][c-protobuf-net] (Marc Gravell) | Code-first binary saves | 3.4.30 (2026-09-16); 69 | `[ProtoModel]` generator, in preview | Apache-2.0 | **Consider**: the strongest binary option |
| [MessagePack-CSharp][c-messagepack] (its organisation) | MessagePack | 3.1.12 (2026-10-12); 35 | Generator; not certified for AOT | MIT and notices | **Consider** for saves and networking; also evaluate Nerdbank.MessagePack, its maintainers' AOT-first successor |
| [MemoryPack][c-memorypack] (Cysharp) | Memory-copy binary format | 1.21.4 (2025-02-12); stalled | Explicit registration | MIT | **Consider** for in-memory snapshots only: not for long-lived saves, and never for fingerprints, which would see struct padding |
| [Tomlyn][c-tomlyn] (Alexandre Mutel) | TOML that keeps comments when edited through its syntax tree | 2.10.1 (2026-07-02) | `IsAotCompatible` | BSD-2 | **Recommend** for settings and tool edits; a round trip through C# objects drops comments |
| [REDox][c-redox] (Capcom) | JSON5 edits that keep comments; MessagePack | 1.0.3 (2026-10-16); 17 days old | Only its token layer is AOT-safe | Apache-2.0 | **Consider**, and watch: the only library here that edits JSON and keeps comments |
| [Microsoft.Data.Sqlite][c-sqlite] (Microsoft) with SQLitePCLRaw (Eric Sink) | Large or slot-based saves, tool data | 10.0.13, on SQLitePCLRaw 2.1; SQLitePCLRaw's latest are 3.0.5 and 2.1.14 | Six; native file beside the executable | MIT, Apache-2.0 with SQLitePCLRaw's `NOTICE.TXT`, public domain | **Consider**; pin one SQLitePCLRaw chain, since 3.x renamed its native package twice |
| ZstdSharp.Port; System.IO.Compression; K4os LZ4 | Compression | 2024–2026 | Yes | MIT, BSD notices | **Recommend** ZstdSharp or Brotli |
| Google.Protobuf; FlatSharp; YamlDotNet; SharpYaml | Schema formats; YAML | 2025–2026 | Mixed | BSD-3, Apache-2.0, MIT | **Consider** where a format is required: `protoc` has no Windows arm64 build, FlatSharp's `flatc` no Windows or Linux arm64, and FlatSharp's compiler fails with only .NET 10 installed; neither for snapshots or fingerprints |
| Newtonsoft.Json; VYaml; LiteDB; Bebop; Ceras | Older or AOT-unsafe serialisers | 2019–2026 | No, or unstated (Bebop) | MIT, Apache-2.0 | **Avoid** |

### Localisation

| Library (owner) | For | Latest; activity | AOT | Licence | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Linguini][c-linguini] (Ygg01) | Project Fluent messages | 0.11.0 (2026-03-15); 83 | Unannotated; its plurals need ICU, so Linux players need `libicu` | MIT or Apache-2.0 | **Recommend** for game text as content, with ICU on; app-local ICU (Microsoft.ICU.ICU4C.Runtime) covers Windows and Linux, not macOS |
| [MessageFormat.NET][c-messageformat] (jeffijoe) | ICU MessageFormat | 8.0.0 (2026-02-23); 0 | `IsTrimmable` | MIT | **Recommend**: its source shows plurals stay correct in invariant mode with `PredefinedCulturesOnly=false` (not run) |
| [GetText.NET][c-gettext]; Karambolo.PO | gettext catalogues; PO files | 10.0.1; 1.13.0 | Unannotated | MIT | **Consider** for a translator workflow |
| `.resx` and `ResourceManager` | Compiled strings | .NET 10 | Yes, satellites included | MIT | **Consider** for engine strings; not reloadable |
| SmartFormat.NET; Humanizer | Formatting text for presentation | 3.6.1; 3.0.10 | Humanizer `IsAotCompatible` | MIT | **Consider** in presentation |
| NGettext; Fluent.Net; ICU4N | Dormant or alpha | 2021–2026 | – | MIT, Apache-2.0 | **Avoid** |

### Scripting and modding

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Lua-CSharp][c-lua-csharp] (nuskey8) | Lua 5.2 in C# | 0.5.7 (2026-09-26); 57 | Managed; AOT by design | MIT | **Recommend** for scripts in the simulation, with the game's maths |
| [MoonSharp][c-moonsharp] | Lua in C#, with sandbox presets | 3.0.0-beta.1 (2026-07-04); 13 | Managed; uses `System.Linq.Expressions` and reflection, so AOT is **Unconfirmed** | BSD-3 notice in documentation | **Consider** |
| [Jint][c-jint] | JavaScript interpreter | 4.17.0 (2026-10-07); 1,058 | Managed; `IsAotCompatible` | BSD-2 and BSD-3 notices | **Recommend** for JavaScript mods, with the game's maths and a seeded `Math.random`; pin 4.x, since Jint 5 changes the interface |
| [wasmtime-dotnet][c-wasmtime] (Bytecode Alliance) | Sandboxed WebAssembly mods | 48.0.2 (2026-09-18); 22 | Six, 17 to 31 MB each; AOT with trimming warnings | Apache-2.0 with LLVM exception: ship its text and the crates' notices, which the package omits | **Recommend** for sandboxed mods |
| WACS; DotWasm | WebAssembly interpreters in C# | 0.16.14 (2026-05-28); 0.1.0 (2026-05-27) | Managed | Apache-2.0; MIT | **Consider** WACS; **watch** DotWasm |
| [ink][c-ink] (inkle); [Yarn Spinner][c-yarnspinner] | Narrative scripting | v1.2.1 (2026-05-05); 3.2.2 (2026-08-11) | Managed | MIT; Yarn adds Google.Protobuf's BSD-3 notice | **Recommend**: take ink from its release or source, since its NuGet package dates from 2017 under other owners; set ink's seed and keep its `POW` out of rules; replace Yarn's random, saliency and culture functions; Yarn saves only between nodes |
| Roslyn scripting; `AssemblyLoadContext` mods | C# scripts and mods | 5.9.0; .NET 10 | Not under NativeAOT | MIT | **Consider** in JIT builds only |
| NLua with KeraLua; ClearScript; Harmony; MonoMod; NeoLua; YantraJS | Native Lua, V8, run-time patching | 2025–2026 | No AOT, native, or macOS 26 minimum | MIT or Apache-2.0; ClearScript adds LGPL code | **Avoid** |

### Networking

| Library (owner) | For | Latest; activity | AOT | Licence | Verdict |
| --- | --- | --- | --- | --- | --- |
| [LiteNetLib][c-litenetlib] (RevenantX) | Reliable UDP, with a mode that starts no threads | 2.1.4 (2026-05-19); 7 | `IsTrimmable` | MIT | **Recommend** |
| [Backdash][c-backdash] (Delta3 Studio) | Rollback netcode | 0.8.0-preview (2026-10-14); 9 | `net10.0`; `IsAotCompatible` | MIT | **Recommend** for rollback, later; maps onto snapshots and fingerprints |
| System.Net.Sockets | Sockets | .NET 10 | Yes | MIT | **Recommend** as the base |
| Riptide; xENet; SpaceWizards.Lidgren | Game messaging; ENet in C#; a Lidgren fork | 2024–2026 | Mixed | MIT | **Consider** |
| grpc-dotnet; MagicOnion | Back-end services | 2.84.0; 7.11.0 | grpc-dotnet client and server; MagicOnion's client only | Apache-2.0; MIT | **Consider** for servers |
| GameNetworkingSockets.Net (vrimar) | Valve's networking library | 0.3.1 (2026-10-01); new | win-x64, linux-x64 and osx-arm64 only; `IsAotCompatible` | MIT, BSD-3, OpenSSL's Apache-2.0, protobuf | **Watch** |
| System.Net.Quic; ENet-CSharp; Lidgren; ValveSockets-CSharp; PleaseUndo | QUIC and older libraries | 2016–2026 | – | MIT | **Avoid**: QUIC needs Windows 11 or `libmsquic`; the others are stale or x64-only |

### Platform services

| Library (owner) | For | Latest; activity | Desktops; AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Steamworks.NET][c-steamworks-net] (Riley Labrecque) | Steam | 2025.164.1 on GitHub (2026-08-02); NuGet has 2024.8.0 from other owners; 9 | Valve's libraries: no Windows arm64 | MIT, plus Valve's SDK terms | **Recommend**, as AnyCPU builds from GitHub, one per platform |
| [Facepunch.Steamworks][c-facepunch-steamworks] | Steam | 2.5.2 on GitHub (2026-04-23); NuGet 2.3.3 (2020); 11 | Valve SDK 1.61: no Windows or Linux arm64; an open pull request says `SocketManager` calls are skipped under NativeAOT | MIT, plus Valve's SDK terms | **Consider**; pump callbacks yourself |
| [DiscordRichPresence][c-discordrpc] (Lachee) | Discord rich presence | 1.6.1.70 (2025-08-04); 0 | Managed; depends on Newtonsoft.Json, which may fail under NativeAOT; untested, so **Unconfirmed** | MIT | **Consider** |
| [butler][c-butler] (itch.io) | Uploads to itch.io | v15.32.0 (2026-10-06) | Tool | MIT; not shipped | **Recommend** as a release tool |
| Epic Online Services | Epic's services | 1.19.1.2, seen in a repackage | Seen for Windows, Linux and macOS | Agreement behind sign-in, **Unconfirmed** | **Consider** after reading the terms |
| GOG GALAXY SDK | GOG's services | **Unconfirmed** | Windows and macOS; no Linux | No public terms found | **Consider** only when shipping on GOG |
| Discord Social SDK | Discord's services | Active | C++; Linux experimental | Not read | **Avoid** for now: no plain .NET binding |

### Pathfinding, procedural generation, noise and randomness

| Library (owner) | For | Latest; activity | AOT | Licence for a game | Verdict |
| --- | --- | --- | --- | --- | --- |
| Grid A* written in the game | Paths with integer costs and stable ties | – | Yes | – | **Recommend** for grids |
| [DotRecast][c-dotrecast] (ikpil) | Navigation meshes: build, query, crowds | 2026.3.1 (2026-08-02); 31 | `net10.0` | zlib | **Recommend** for queries: bake offline on one thread, supply the random source, and fork the crowd code, which uses `MathF.Sin` |
| [GoRogue 3][c-gorogue] | Roguelike paths, field of view, map generation | 3.0.0-beta11 (2025-12-28) | Managed; not marked AOT-compatible; its message bus uses reflection | MIT | **Consider** with the game's generator and ID generator, parallel sense maps off, and its primitives' trigonometry out of the rules; never with OptimizedPriorityQueue 5 |
| [FastNoiseLite][c-fastnoiselite] (Auburn) | Noise in one C# file | v1.1.1 (2024-03-05) | Yes | MIT | **Recommend**: only `Math.Sqrt`, no hidden state |
| [OpenSimplex2][c-opensimplex2] (K.jpg) | Simplex noise in C# files | `4cd120d` (2024-01-29) | Yes | CC0 | **Recommend** |
| [Clipper2][c-clipper2] (Angus Johnson) | Polygon Booleans and offsets | 2.0.0 (2025-12-17) | Probably (**Inference**) | Boost: nothing for binaries | **Recommend** its integer Booleans; offsets outside the tick |
| [DeBroglie][c-debroglie] | Wave function collapse | 2.1.0 (2025-12-21) | **Unconfirmed**, not examined | MIT | **Consider** at setup or build time, given the game's `RandomDouble` in place of its unseeded default |
| WaveFunctionCollapse (mxgmn) | Wave function collapse, as a console program | – | – | MIT, not covering its sample tiles | **Consider** as a reference to port, without its ImageSharp dependency |
| Delaunator; MIConvexHull | Triangulation and hulls | 2019–2025 | Probably for Delaunator (**Inference**); not examined for MIConvexHull | MIT | **Consider** Delaunator at setup, on jittered or integer points, and MIConvexHull in tools only |
| A generator written in the game | SplitMix64, xoshiro or PCG, state in game state | – | Yes | Public domain or Apache-2.0 | **Recommend** |
| FastNoise2; `System.Random` | Native SIMD noise; .NET's generator | 2024–2026 | – | MIT | **Avoid** in the simulation: results depend on the CPU, or the state cannot be saved |
| Triangle.NET; SharpNoise; Roy-T.AStar; RogueSharp; SharpNav | Older or restricted libraries | 2015–2026 | – | Commercial use by arrangement; LGPL-3.0; MIT | **Avoid**: restricted in sold games, LGPL, or bugs |

### Testing

| Library (owner) | For | Latest; activity | AOT | Licence (developer tool) | Verdict |
| --- | --- | --- | --- | --- | --- |
| [xUnit v3][c-xunit] on Microsoft.Testing.Platform 2 | Tests | 4.0.2 (2026-10-09); 60 | `.aot` packages, C# only | Apache-2.0; the platform's telemetry is on by default, and its Retry and Hot Reload extensions are proprietary | **Recommend**, with telemetry off |
| [CsCheck][c-cscheck] (Anthony Lloyd) | Property, model-based and concurrency tests | 4.9.1; 5.0.0-rc2 (2026-10-14) | 5.0 `IsAotCompatible` | Apache-2.0 | **Recommend** for random action sequences |
| [BenchmarkDotNet][c-benchmarkdotnet] | Micro-benchmarks | 0.15.8 (2025-11-30); 72 | NativeAOT toolchain | MIT | **Recommend** locally |
| [AwesomeAssertions][c-awesomeassertions] | Fluent assertions | 9.6.0 (2026-08-20) | Not trimmable | Apache-2.0 | **Recommend** if fluent style is wanted |
| [TUnit][c-tunit] | Source-generated tests | 1.75.0 (2026-10-13); 554 | `IsAotCompatible` | MIT; its metapackage pulls in Microsoft's closed-source code coverage | **Consider**: best AOT story, one maintainer, heavy churn |
| NUnit 5; MSTest 4 | Tests | 5.0.0; 4.5.1 | NUnit none; MSTest's under proprietary terms | MIT; MSTest's metapackage pulls in Microsoft's closed-source code coverage | **Consider** under JIT |
| [Verify][c-verify] | Approval tests | 33.3.4 (2026-10-16) | JIT only | MIT source; 33.x fee terms; 32.0.1 fee-free | **Consider** 32.0.1 |
| Image comparers: Codeuctivity's, Verify.ImageMagick | Rendering checks | 2026 | JIT | Apache-2.0; ImageMagick and LGPL parts; Verify.ImageMagick needs Verify 33.3, so its fee terms apply | **Consider** |
| FluentAssertions 8; Verify.ImageSharp; Verify.Phash; ImageSharp directly | Assertions and image checks | 2023–2026 | – | Paid per developer; AGPL; GPL dependency; Split License | **Avoid** |

### Profiling, GPU capture, logging and diagnostics

| Library (owner) | For | Latest | Desktops; AOT | Licence | Verdict |
| --- | --- | --- | --- | --- | --- |
| `System.Diagnostics.Metrics` with `MeterListener` | Tick time, frame time and counts, read by the development layer | .NET 10 | All | MIT | **Recommend** |
| dotnet-trace, dotnet-counters, dotnet-dump (Microsoft) | Traces, counters, dumps | 10.0.750501 (2026-10-07) | All; NativeAOT needs `EventSourceSupport=true`; dotnet-dump reads JIT dumps only; whether NativeAOT traces show C# names is **Unconfirmed** | MIT | **Recommend**, run by Playstead from outside the game |
| [Tracy][c-tracy] | Frame and zone profiler | v0.14.1 (2026-08-22) | Viewer prebuilt for win-x64, linux-x64 and macOS arm64; the C# binding examined needs macOS 26, glibc 2.38 and the Visual C++ runtime | BSD-3 and notices | **Recommend** the viewer; a binding only after trials, in development builds |
| [RenderDoc][c-renderdoc] | GPU frame capture: OpenGL, Vulkan, Direct3D | v1.46 (2026-08-31) | win-x64 and linux-x64 only | MIT | **Recommend** where it runs |
| Xcode's Metal capture; PIX | GPU capture on macOS, including Vulkan through MoltenVK; Direct3D 12 on Windows, arm64 included | 2026 | – | Vendor terms | **Recommend** per platform; nothing captures OpenGL on macOS |
| Nsight; apitrace | GPU capture on NVIDIA RTX cards; OpenGL traces | 2026 | – | Vendor terms; MIT | **Consider**: Nsight on NVIDIA machines, apitrace on Linux |
| [netcoredbg][c-netcoredbg] (Samsung) | A debugger agents can drive | 3.2.0 (2026-06-25); 0 | JIT only, so NativeAOT needs lldb, gdb or WinDbg; no win-arm64 or osx-x64 build, and the osx-arm64 build is community-supported | MIT | **Recommend**; Microsoft's `vsdbg` is limited to its editors |
| Microsoft.Extensions.Logging with `[LoggerMessage]` | Logging | 10.0.13 | `IsAotCompatible`; no file provider built in | MIT | **Recommend**, with a file provider added |
| Serilog; NLog | Structured logging | 4.4.0; 6.2.2 | Configure in code for AOT | Apache-2.0; BSD | **Consider** |
| [Sentry][c-sentry] | Crash reports, including native crashes under NativeAOT | 6.12.1 (2026-10-13) | Six | MIT, notices; a data processing agreement | **Recommend** for opt-in crash reports in release builds, the person's choice, since Playstead has no telemetry |
| `createdump`; the systems' crash reports | Crash dumps | .NET 10 | Under NativeAOT, Linux and macOS only, with `createdump` beside the executable; Windows falls back to Windows Error Reporting, whose local dumps an administrator must turn on | MIT | **Recommend** in development builds |
| ZLogger; log4net; Optick; Intel GPA; other crash reporters | Older or stalled tools | 2022–2026 | Gaps | Various | **Avoid** |

## Recommended combinations

### Proven together

Shipped games, official samples and dependency graphs show these working together (**Documented** or **Observed**):

- **MonoGame.** Gum in MonoGame's own tutorial ([chapter 20][mg-tutorial-gum]); Hexa.NET.ImGui with MonoGame.Extended in the Ember particle editor ([Ember][ember]); FontStashSharp, MonoGame.Aseprite and LDtkMonogame, each with a MonoGame build; Backdash's rollback samples ([Backdash][c-backdash]); OpenAL Soft with NVorbis inside DesktopGL itself.
- **FNA.** SDL3, FNA3D, FAudio and Theorafile come as one set of natives; Gum, SadConsole and MLEM publish FNA builds; MoonTools.ECS comes with an FNA template.
- **SDL3.** osu! runs ppy.SDL3-CS with ppy's Veldrid fork, BASS and SharpFNT ([osu.Framework.csproj][osu-csproj]).
- **Space Station 14** combines SpaceWizards.Sdl, OpenTK's OpenAL binding, Linguini, a Lidgren fork, DiscordRichPresence and Roslyn scripting for its development console ([RobustToolbox][ss14-props]).
- **Elsewhere.** Box2D.NET's samples run on Silk.NET with ImGui; StaticEcs underpins an experimental Raylib-cs engine and a rollback sample.

### Conflicts

- **One XNA framework (Inference).** MonoGame, FNA and KNI all define `Microsoft.Xna.Framework`, so a game references one, and every add-on must be the build for it.
- **One platform layer (Inference).** MonoGame DesktopGL loads SDL 2, FNA and Foster load SDL3, and raylib links GLFW into itself. A second SDL or GLFW in the same process would own the same window and events. On MonoGame, ImGui is drawn by a MonoGame renderer, not by Hexa's SDL3 backend.
- **One sound library (Inference).** Each framework opens the sound device itself. A second sound library opens a second stream, and an offline render hears only one of them, so a game that wants gameplay video with sound sends all its sound through one library that renders on request.
- **Native files with the same name (Observed).** Several packages ship `SDL3`, `libopenal`, `cimgui`, `freetype`, `box2d` or `e_sqlite3` files built from different versions. In one output folder the last copy wins, or publishing fails.
- **Version skews (Observed, Documented).** rlImgui-cs 3.2.0 needs Raylib-cs 7, while Gum.raylib needs 8. Apos.Gui 3.0.0 depends on MonoGame.Extended 5. MonoGame.Extended's content pipeline fails on MonoGame 3.8.6, with a fix pending for 6.2.0 ([#1206][mge-1206]). Avalonia 12.1.4 needs SkiaSharp 3 and SkiaSharp.Skottie 4.153.1 needs SkiaSharp 4, and one process loads one `libSkiaSharp`. FontStashSharp's HarfBuzz shaper pins HarfBuzzSharp 8.3.1.2. GoRogue 3 cannot be combined with OptimizedPriorityQueue 5. FluentAssertions and AwesomeAssertions 8 ship the same assembly.
- **Two kinds of vector (Observed, Inference).** MonoGame converts its vectors to `System.Numerics` implicitly, so `Vector2.Lerp` can slip into the simulation unnoticed, and physics and pathfinding libraries bring their own types. Game state keeps one type, values are converted at the boundary, and a source check bans the helpers in [the sealed simulation](#the-sealed-simulation).
- **Two readers of input (Documented, Inference).** UI libraries that read devices themselves, such as MLEM and, by default, Gum, Myra and the ImGui sample renderers, see the same click as the game. Input goes through the game's input mapping, and the game honours the UI's capture flags, such as ImGui's `WantCaptureMouse`.
- **Clocks and generators per process (Observed).** Apos.Tweens, Nez and MonoGame.Extended's particles each keep one clock or generator per process, so runs that share a process share them.
- **Threads (Inference).** An entity system's own threads, the Task Parallel Library and a physics library's workers compete for cores, so a simulation uses one scheduler. Native code can change the floating-point settings of the thread that calls it, so native calls stay off the simulation's thread.
- **Two Steam libraries (Inference).** Steamworks.NET and Facepunch.Steamworks both own `steam_api` and its callbacks; a game uses one.

### By kind of game

A starting set for each kind of game (**Inference** from the catalogue). A game adds only what it needs, and the prototype that adds a library proves it.

| Kind of game                                | Foundation                                                             | Starting set                                                                                                                                                                                                                                                                                                              | Keep out                                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **2D platformer** (0.1)                     | MonoGame DesktopGL                                                     | Collisions against tiles written in the game; MonoGame.Aseprite for animation; DotTiled or LDtkMonogame for levels; FontStashSharp for text; Gum for menus; tweens and particles of the game's own, driven by ticks; MonoGame's sound; System.Text.Json saves; Hexa.NET.ImGui in development builds; xUnit v3 and CsCheck | Native Box2D; MonoGame.Extended's content pipeline; the frameworks' and `System.Numerics` rotation and interpolation helpers in the rules |
| **2D puzzle game** (0.1)                    | MonoGame DesktopGL                                                     | Grid state in arrays of structs, so undo is a snapshot; FontStashSharp; Gum, or Apos.Gui where UI tests must run headless; tweens of the game's own; System.Text.Json for saves and levels; CsCheck for random move sequences                                                                                             | Physics libraries and entity systems, which a grid does not need                                                                          |
| Top-down or roguelike                       | MonoGame, or FNA                                                       | Grid A* of the game's own, or GoRogue 3 with the game's generator; FastNoiseLite; DotTiled; SadConsole for text-mode games                                                                                                                                                                                                | `System.Random`; RogueSharp                                                                                                               |
| Physics-driven 2D                           | MonoGame                                                               | Box2D.NET; until it ports Box2D's snapshots, a state is restored by replaying from the start                                                                                                                                                                                                                              | Native Box2D packages and Aether.Physics2D, which do not replay across machines                                                           |
| Story-led                                   | MonoGame                                                               | ink or Yarn Spinner, with seeds set and Yarn's culture-dependent functions replaced; Linguini or MessageFormat.NET for translations; FontStashSharp with HarfBuzzSharp for writing systems that need shaping                                                                                                              | Culture-sensitive formatting in the rules                                                                                                 |
| Online, later                               | MonoGame                                                               | LiteNetLib; Backdash for rollback, built on snapshots and fingerprints; Steamworks.NET from GitHub                                                                                                                                                                                                                        | Two Steam libraries; QUIC on older Windows                                                                                                |
| Rendering-heavy, or frames without a window | SDL3 through SDL3-CS                                                   | SDL_GPU with the game's own renderer; shaders in Slang or HLSL compiled offline; miniaudio or SDL3_mixer, which render sound on request; Hexa.NET.ImGui with its SDL3 backend                                                                                                                                             | SDL development builds in a shipped game                                                                                                  |
| 3D, later                                   | SDL3 with Vortice.Vulkan or WebGPUSharp, or MonoGame's native backends | SharpGLTF; Jitter2 in its deterministic mode                                                                                                                                                                                                                                                                              | BEPUphysics and JoltPhysicsSharp's natives, for replay                                                                                    |

**Gameplay video (Inference).** The development layer renders video from a replay "with its sound rendered in sync" ([DEVELOPMENT-LAYER.md][devlayer-video]). MonoGame documents no way to render its sound on request, and FAudio's way is unproven (**Unconfirmed**), so a game that adds video rendering sends all its sound through miniaudio, through Hexa.NET.MiniAudio, instead; Playstead encodes the frames and sound with FFmpeg.

### The foundation for 0.1

**MonoGame DesktopGL 3.8.6 for both of 0.1's games (Inference).** The measurements found no cost that sets it apart: builds, Hot Reload, start-up, read-back and exports were within tenths of a second or a few megabytes of the other foundations. What sets it apart is that it is the only maintained complete framework whose packages reach all six desktops, that agents know its interface, and that most add-ons in the catalogue have a MonoGame build. The roadmap already leaves reconsidering it until after 0.1 ([ROADMAP.md][roadmap-after]). It comes with conditions:

1. **Preview and agent runs draw without vsync** and cap frames in the game loop, because with vsync on and the display asleep its first frame never finished (**Observed**).
2. **Every export ships OpenAL Soft's LGPL text, notice and source offer** and keeps `libopenal` a separate file (**Documented**).
3. **The AOT analysers run in CI and release builds only**, because at 100,000 lines they nearly tripled the one-line rebuild in `Debug` (**Observed**).
4. **The development layer stops a run through the game's own loop**, and kills it after a timeout, because FNA spun on after SIGTERM and MonoGame ignored an early `Exit()` (**Observed**).
5. **Windows on Arm is checked on a real laptop**, because MonoGame does not test its OpenGL there (**Unconfirmed**).
6. **Content stays with SpriteBatch and the built-in effects**, as the [roadmap][roadmap-versions] says, because MonoGame's effect compiler needs Wine outside Windows (**Documented**).

**What would change it (Inference).** FNA becomes the better choice if MonoGame's OpenGL fails on Windows on Arm or the LGPL duties are unwelcome, once someone builds FNA's Windows arm64 natives. MonoGame's native backends remove OpenAL Soft and Wine, and may suit once they settle. SDL3 becomes the foundation for a game whose preview must have frames without a window.

## The know-how in Playstead

A proposal for the founder to decide (**Inference**, building on [#85][issue-85] and [PRODUCT.md][product]).

### Its form

| Part                                                                 | Holds                                                                                                                                                                         | Lives in                                                                            | Changed by                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Catalogue data**                                                   | One entry per library and per combination: facts, judgements, known problems and evidence                                                                                     | Playstead's repository, shipped with Playstead                                      | Reviewed pull requests, some opened by a weekly refresh |
| **A choosing skill per stack**, such as `playstead-csharp-libraries` | How to choose, add, replace and upgrade a library with the person; a reference file per area; combinations; known problems; live checks; what agents tend to remember wrongly | Each game's `.agents/skills/`, copied when the game is created                      | Playstead releases; the person accepts each update      |
| **Usage skills**                                                     | How to use a library the game uses, at its version                                                                                                                            | The game's skills, added when a prototype that adopts the library is kept           | With the library's version ([#98][issue-98])            |
| **The game's own records**                                           | Its library decisions and reasons, its constraints, and the known problems it met                                                                                             | The game project ([#93][issue-93]), with a short constraints section in `AGENTS.md` | The person and the agent; never a Playstead update      |

- **Versions** live only in the game's project files.
- **One skill, not one per library (Documented).** Both agents keep every skill's description in context on every turn, within a budget: Codex 2% of the context window or 8,000 characters; Claude 1%, with an 8,000-character fallback and at most 1,536 characters per skill. Past the budget, both drop descriptions and Codex drops whole skills ([Codex][codex-skills], [Claude Code][cc-skills]). A skill per library would overflow it; one choosing skill with a reference file per area costs one description. Anthropic's and OpenAI's own skills for their large, changing documentation take this form ([claude-api][anth-claude-api-skill], [openai-docs][openai-docs-skill]).
- **A data file behind it (Inference).** Tools refresh the facts and people review the judgements; Markdown generated from one file keeps one source of truth. This note's catalogue is its first content.
- **A copy in each game (Inference).** Under PRODUCT.md, each game keeps its skill versions until the person accepts an update; a folder shared by every game would change them all at once. Fast-changing facts are read live, so the copy does not go stale where it matters.

### What an entry records

- **Identity:** what the library does, in game terms and technically, and the areas it covers.
- **Distribution:** the official channel, the package IDs and owners, and the packages to avoid. NuGet alone misleads (**Observed**): Steamworks.NET's NuGet package stops at 2024.8.0 under other owners, while its GitHub releases reach 2025.164.1 ([releases][steamworksnet-releases]); Facepunch.Steamworks on NuGet dates from 2020 ([releases][facepunch-releases]); SharpDX is archived but not deprecated ([SharpDX][sharpdx-repo]).
- **Licence:** what a game must do, a link to the exact terms, and the licences of the native libraries it carries.
- **Platforms:** target frameworks, the six desktops, NativeAOT and trimming.
- **Fit:** replay across x64 and arm64, snapshots, headless runs, frames for the preview and Hot Reload.
- **Agents:** what they know, what they get wrong, and the library's policy on AI-written contributions, with the date it was checked.
- **Known problems:** the packages, the affected versions, the effect in game terms, the upstream link, the version and commit that fix it, and a workaround. For example, MonoGame's fix for spaces lost from fonts built without kerning ([#4027][mg-4027]) is in 3.8.6 but not in 3.8.5.1, which was published a day after the fix merged (**Observed**).
- **Combinations,** proven or conflicting, with evidence.
- **Checked:** the version, the date and the level of evidence: *researched* (documents and packages read), *built* (compiles and starts on the six desktops in Playstead's CI), *proven* (used in a Playstead test game, with replay, preview frames and export checked) or *reported* (evidence people chose to send). Every row in this note is researched; the five foundations are also partly built, on one Mac.
- **Facts,** refreshed by machine with their date: the latest version and its date, deprecation, advisories, whether the repository is archived, commits in 90 days and downloads.
- **Verdict:** recommend, consider, watch or avoid; for which kinds of game; the reason, the date and the reviewer.

### How evidence flows in

1. **In a game,** a library that misbehaves becomes a known problem in the game's records: the version, the effect in game terms, and the run and revision that showed it.
2. **It reaches Playstead only when the person sends it,** through Report a problem, without the game's code, content or names. There is no telemetry.
3. **It goes upstream only from the person.** Several of these libraries refuse AI-written issues and patches ([Agents](#agents)), so the agent gives the person the facts.
4. **Playstead's maintainers reproduce it** in a canary build and change the entry in a pull request that links the evidence.
5. **Playstead's 0.1 test games and canaries** raise entries to built and proven.
6. **A Playstead release carries the changed catalogue.** Each game is offered the updated skill with its exact changes, and keeps its version until the person accepts.

### How it stays current

- **Facts, weekly.** A job reads NuGet's search and registration ([search][nuget-search], [registration][nuget-reg]), GitHub (archived, last push, releases, commits in 90 days, changes to `AGENTS.md`, each known problem's issue) and OSV ([OSV][osv-api]), then opens a pull request that rewrites the facts and lists what needs review. About 150 packages at five GitHub requests each fits the 1,000 requests an hour that a workflow's token allows ([rate limits][gh-rate]).
- **Evidence, per release.** A canary project for each recommended combination pins its libraries. Renovate or Dependabot opens a pull request when one of them releases, and CI builds it and runs its checks, including replay on x64 and arm64.
- **Judgements, when facts cross a line.** A new major version, a deprecation, an archived repository, a serious advisory, a new AI policy, a year without commits or a fixed known problem sends the verdict for review. Each verdict says which version it was checked against, and when.
- **In a game, at decision time.** The skill has the agent run `dotnet package list --outdated --format json`, again with `--deprecated` and `--vulnerable`, and `dotnet package search`, before naming a version. Offline, the agent uses the bundled facts and says how old they are.

### How a recommendation reaches the person

- **The game's constraints come first.** The catalogue never overrides them; the agent discusses a change to them, as PRODUCT.md says.
- **One choice and at most two alternatives, in game terms.** For an open need, the agent builds the most promising option as a prototype and offers one or two clearly different directions, each by its effect on the game: feel, where it runs, whether replays stay exact, size, and what the game must ship.
- **A clear instruction gets no alternatives.** The agent does what was asked and states once any fact that changes the outcome. A library the person names is used.
- **Costs are put to the person first.** Before building with a library outside the catalogue, or one with copyleft terms, fees, visible credit or a missing desktop, the agent says so in game terms and waits.
- **Keeping is the decision.** Keeping the prototype says which libraries it adds and what the game must then ship; the agent records the choice, the reason, the alternatives and the duties accepted in the game's records.
- **A generic licence check.** Before recommending any library, the agent reads its licence; if it requires visible credit, the agent puts that to the person as a cost before building.

## Open points

- **Windows and Linux (Unconfirmed).** Every measurement ran on one Mac, with x64 under Rosetta 2. Nothing here ran on Windows, Windows on Arm or Linux; Playstead's CI and the founder's laptop checks cover them.
- **x64 maths on a real x64 computer (Unconfirmed).** Rosetta 2 offers .NET no AVX2 or FMA, so the x64 runs here saw no fused instructions; with `ROSETTA_ADVERTISE_AVX=1`, the JIT used them. A real x64 computer with AVX2 would fuse like the second case, which the [probe](#replay-across-arm64-and-x64) covered, but its C runtime differs from Apple's, and no such computer ran it.
- **Sound rendered on request (Unconfirmed).** Whether FAudio can be driven tick by tick, and whether miniaudio's offline render is identical on x64 and arm64, were not run.
- **Physics across architectures (Unconfirmed).** Box2D.NET's replay across x64 and arm64, and Jitter2's claim of cross-platform determinism, were not run here.
- **Agents' windows in a sandbox (Observed, Unconfirmed).** Inside Codex's sandbox, the FNA game could not open a window ("The video driver did not add any displays"); how the development layer runs games under each permission mode is open ([#82][issue-82]).
- **Skill behaviour (Unconfirmed).** Whether either agent consults a choosing skill before adding a package from memory, what Playstead's starter skills and twenty personal skills leave of the listing budget, and whether `dotnet package list` can reach NuGet in each permission mode need trials.
- **Terms behind sign-in (Unconfirmed).** The terms of Epic Online Services, GOG GALAXY and Discord's Social SDK were not read.
- **Input and accessibility (Unconfirmed).** The catalogue has no area of its own for input libraries, such as rebinding and controller databases, or for accessibility, such as screen readers; the foundations' own input is covered above, and both areas are still to research.
- **Decided elsewhere.** Where a game's records live ([#93][issue-93]); the choosing skill's name and the starter skills ([#98][issue-98]); how the Playstead library and skills reach a game and are versioned ([#90][issue-90]); what an export ships, including the LGPL notices ([#97][issue-97]); whether the refresh job runs in Playstead's public repository; and how agents learn which libraries carry visible-credit terms without Playstead publishing their names.

## References

[ticket]: https://github.com/softhatgames/playstead/issues/106
[ticket-103]: https://github.com/softhatgames/playstead/issues/103
[adr-0004]: ../adr/0004-code-first-games-starting-with-csharp.md
[note-export]: https://github.com/softhatgames/playstead/blob/24647002c9a9644ad9aa37c24aa5bff5c48e9bce/docs/research/monogame-desktop-export.md
[fnalibs-readme]: https://github.com/FNA-XNA/fnalibs-dailies/blob/5bf12d215f17526323c7499c324435c578af18a0/fnalibs.README
[raylibcs-readme]: https://github.com/raylib-cs/raylib-cs/blob/v8.1.0/README.md
[raylib-60]: https://github.com/raysan5/raylib/releases/tag/6.0
[sdl-versions]: https://github.com/libsdl-org/SDL/blob/release-3.4.18/docs/README-versions.md
[eg-sdl3-readme]: https://github.com/edwardgushchin/SDL3-CS/blob/v3.4.18.0/README.md
[silk-2230]: https://github.com/dotnet/Silk.NET/releases/tag/v2.23.0
[silk-readme]: https://github.com/dotnet/Silk.NET/blob/main/README.md
[foster-audio-issue]: https://github.com/FosterFramework/Foster/issues/19
[nuget-foster]: https://www.nuget.org/packages/FosterFramework/0.4.2
[nuget-kni-sdl2gl]: https://www.nuget.org/packages/nkast.Kni.Platform.SDL2.GL/4.3.9001
[nuget-opentk-glfw]: https://www.nuget.org/packages/OpenTK.redist.glfw/3.4.0.44
[note-odin]: odin-and-compile-speed.md
[mg-texture-getdata]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/Graphics/Texture2D.OpenGL.cs#L225-L290
[fna3d-sdlgpu-readback]: https://github.com/FNA-XNA/FNA3D/blob/26.10/src/FNA3D_Driver_SDL.c#L1031-L1056
[sdl-gpu-h]: https://github.com/libsdl-org/SDL/blob/release-3.4.18/include/SDL3/SDL_gpu.h
[fna-aot]: https://github.com/FNA-XNA/docs/blob/af4cb412cf41cae1a1b5d13ce05b374068a9e4a9/docs/appendix/Appendix-A%3A-NativeAOT-on-PC.md
[silk-troubleshooting]: https://dotnet.github.io/Silk.NET/docs/hlu/troubleshooting.html
[sdk-analyzers]: https://github.com/dotnet/sdk/blob/release/10.0.1xx/src/Tasks/Microsoft.NET.Build.Tasks/targets/Microsoft.NET.Sdk.Analyzers.targets#L76-L96
[sdl2-cocoa-swap]: https://github.com/libsdl-org/SDL/blob/release-2.32.10/src/video/cocoa/SDL_cocoaopengl.m#L470-L500
[mg-runoneframe]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Game.cs#L428-L450
[mg-headless-issue]: https://github.com/MonoGame/MonoGame/issues/7121
[fna-nulldevice]: https://github.com/FNA-XNA/FNA/blob/26.10/src/Graphics/GraphicsAdapter.cs#L111-L121
[sdl-offscreen]: https://github.com/libsdl-org/SDL/blob/release-3.4.18/src/video/offscreen/SDL_offscreenvideo.c#L87-L101
[dotnet-jit-contraction]: https://github.com/dotnet/runtime/blob/v10.0.13/src/coreclr/jit/lowerarmarch.cpp#L166-L200
[dotnet-vector2-lerp]: https://github.com/dotnet/runtime/blob/v10.0.3/src/libraries/System.Private.CoreLib/src/System/Numerics/Vector2.cs#L635-L643
[dotnet-mae-x64]: https://github.com/dotnet/runtime/blob/v10.0.13/src/coreclr/jit/hwintrinsicxarch.cpp#L3183-L3212
[dotnet-aot-isa]: https://github.com/dotnet/runtime/blob/v10.0.13/src/coreclr/tools/Common/InstructionSetHelpers.cs#L19-L45
[dotnet-intrinsics-design]: https://github.com/dotnet/runtime/blob/v10.0.13/docs/design/coreclr/botr/vectors-and-intrinsics.md#L159-L165
[dotnet-math-crt]: https://github.com/dotnet/runtime/blob/v10.0.13/src/coreclr/System.Private.CoreLib/src/System/Math.CoreCLR.cs#L19-L130
[rosetta]: https://developer.apple.com/documentation/apple-silicon/about-the-rosetta-translation-environment
[issue-82]: https://github.com/softhatgames/playstead/issues/82
[fna-glibc]: https://github.com/FNA-XNA/docs/blob/af4cb412cf41cae1a1b5d13ce05b374068a9e4a9/docs/appendix/Appendix-F%3A-Upcoming-Support-Changes.md
[hexa-imgui-90]: https://github.com/HexaEngine/Hexa.NET.ImGui/issues/90
[steamworksnet-releases]: https://github.com/rlabrecque/Steamworks.NET/releases
[roslyn-73689]: https://github.com/dotnet/roslyn/issues/73689
[harmony]: https://github.com/pardeike/Harmony/blob/v2.4.3/README.md
[mge-tweening]: https://github.com/MonoGame-Extended/Monogame-Extended/tree/v6.1.1/source/MonoGame.Extended/Tweening
[mg-packaging]: https://github.com/MonoGame/docs.monogame.github.io/blob/df441c8dd21e3c1f6f91a101e40ef65d4e5d4204/articles/getting_started/packaging_games.md
[mg-web-pr]: https://github.com/MonoGame/MonoGame/pull/9559
[mg-consoles]: https://github.com/MonoGame/docs.monogame.github.io/blob/df441c8dd21e3c1f6f91a101e40ef65d4e5d4204/articles/console_access.md
[fna-faq]: https://github.com/FNA-XNA/docs/blob/af4cb412cf41cae1a1b5d13ce05b374068a9e4a9/docs/0%3A-FAQ.md
[fna-consoles]: https://github.com/FNA-XNA/docs/blob/af4cb412cf41cae1a1b5d13ce05b374068a9e4a9/docs/appendix/Appendix-B%3A-FNA-on-Consoles.md
[mg-milestones]: https://github.com/MonoGame/MonoGame/milestones
[note-dotnet]: https://github.com/softhatgames/playstead/blob/c6e61bc25b6744d696b0d2e77bd1225710c836d5/docs/research/dotnet-library-delivery.md
[mg-template]: https://github.com/MonoGame/MonoGame.Templates/blob/90600c8d8efb14a6e7ab6950c76a2f79e8e44f45/CSharp/content/MonoGame.Application.DesktopGL.CSharp/MGNamespace.csproj
[roslyn-enc-struct]: https://github.com/dotnet/roslyn/blob/3645b6aa36ad41775a73e57a620787a3d38327a0/src/Features/Core/Portable/FeaturesResources.resx#L360-L361
[dotnet-invert]: https://github.com/dotnet/runtime/blob/v10.0.13/src/libraries/System.Private.CoreLib/src/System/Numerics/Matrix4x4.Impl.cs#L1136-L1148
[mg-vector2-rotate]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Vector2.cs#L1368-L1385
[fna-matrix-trig]: https://github.com/FNA-XNA/FNA/blob/26.10/src/Matrix.cs#L806
[random-docs]: https://learn.microsoft.com/en-us/dotnet/api/system.random
[hashcode-docs]: https://learn.microsoft.com/en-us/dotnet/api/system.hashcode
[xxhash3-docs]: https://learn.microsoft.com/en-us/dotnet/api/system.io.hashing.xxhash3?view=net-10.0
[mg-random]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Random.cs
[arch-commandbuffer]: https://github.com/genaray/Arch/blob/04d52e7268eb6f376ca4841a0c204334120c5e9d/src/Arch/Buffer/CommandBuffer.cs#L138-L416
[dotnet-globalization]: https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu
[staticecs]: https://github.com/Felid-Force-Studios/StaticEcs/blob/23b1cf36d89497e8a126d38459d688e2b0a5dea3/docs/en/features/serialization.md
[arch-303]: https://github.com/genaray/Arch/issues/303
[box2dnet]: https://github.com/ikpil/Box2D.NET/tree/3.1.654
[jitter2-determinism]: https://github.com/notgiven688/jitterphysics2/blob/f89d0c6abed99b93b2ec9a7b0d2454f81108a7a1/docfx/docs/documentation/general.md#L29-L52
[lua-seed]: https://github.com/NLua/lua/blob/68abdd03688b97660d8f41e163fecf462b537f7a/src/lstate.c
[mg-9535]: https://github.com/MonoGame/MonoGame/pull/9535
[fna3d-sysrenderer]: https://github.com/FNA-XNA/FNA3D/blob/26.10/include/FNA3D_SysRenderer.h
[runner-images]: https://github.com/actions/runner-images/blob/ee1ff4569e381a9649b400338bdc8ceb7e18a80e/images/ubuntu/Ubuntu2404-Readme.md
[silk-swiftshader]: https://www.nuget.org/packages/Silk.NET.Vulkan.SwiftShader.Native/2025.9.8
[fna3d-warp]: https://github.com/FNA-XNA/FNA3D/blob/26.10/src/FNA3D_Driver_D3D11.c#L5200-L5212
[runner-metal]: https://github.com/actions/runner-images/issues/14840
[oal-loopback]: https://openal-soft.org/openal-extensions/SOFT_loopback.txt
[sdl-mixer-generate]: https://github.com/libsdl-org/SDL_mixer/blob/release-3.2.4/include/SDL3_mixer/SDL_mixer.h
[miniaudio]: https://github.com/mackron/miniaudio/blob/9634bedb5b5a2ca38c1ee7108a9358a4e233f14d/miniaudio.h
[fna-processexit]: https://github.com/FNA-XNA/FNA/blob/26.10/src/FNAPlatform/FNAPlatform.cs#L237
[fna-programexit]: https://github.com/FNA-XNA/FNA/blob/26.10/src/FNAPlatform/SDL3_FNAPlatform.cs#L308-L315
[mg-keyboardstate]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Input/KeyboardState.cs#L112-L125
[sdl-push-event]: https://github.com/libsdl-org/SDL/blob/release-3.4.18/include/SDL3/SDL_events.h
[devlayer-builds]: ../DEVELOPMENT-LAYER.md#builds-and-where-a-game-runs
[ftl]: https://gitlab.freedesktop.org/freetype/freetype/-/blob/VER-2-14-1/docs/FTL.TXT
[libjpeg-turbo]: https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.1.2/LICENSE.md
[bass]: https://www.un4seen.com/bass.html
[sixlabors-license]: https://github.com/SixLabors/ImageSharp/blob/v4.1.3/LICENSE
[spine-license]: https://github.com/EsotericSoftware/spine-runtimes/blob/fc2ae27725c886d886fd88d9621c3e665c234615/LICENSE
[steamworks-redist]: https://partner.steamgames.com/documentation/sdk_access_agreement
[agility-sdk]: https://www.nuget.org/packages/Microsoft.Direct3D.D3D12/1.619.1
[oal-alc]: https://github.com/kcat/openal-soft/blob/1.24.3/alc/alc.cpp#L1-L19
[lgpl21]: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt
[mg-notices]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/THIRD-PARTY-NOTICES.txt
[aot-interop]: https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/interop
[fluentassertions-license]: https://github.com/fluentassertions/fluentassertions/blob/8.11.0/LICENSE
[verify-fee]: https://github.com/VerifyTests/Verify/blob/33.3.4/docs/maintenance-fee.md
[vsdbg-license]: https://github.com/dotnet/vscode-csharp/blob/v2.160.4/docs/debugger/Microsoft-.NET-Core-Debugger-licensing-and-Microsoft-Visual-Studio-Code.md
[mg-agents]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/AGENTS.MD
[sdl-agents]: https://github.com/libsdl-org/SDL/blob/83ab835bfd48b9fea3fefbf84f65ae898fedaffb/AGENTS.md
[fna-agents]: https://github.com/FNA-XNA/FNA/blob/26.10/AGENTS.md
[silk-agents]: https://github.com/dotnet/Silk.NET/blob/e2fa77a4589d8305f7f64f271d6b9a655d0fac29/AGENTS.md
[mge-agents]: https://github.com/MonoGame-Extended/MonoGame-Extended/blob/648230635a353cef421d57d715e57b4f0f95b121/AGENTS.md
[xunit-ai]: https://github.com/xunit/xunit/blob/v3-4.0.2/ai.txt
[arch-llms]: https://arch-ecs.gitbook.io/arch/llms.txt
[tunit-llms]: https://tunit.dev/llms.txt
[gum-claude]: https://github.com/vchelaru/Gum/blob/9f71cd0f85f96c1dd1249e849ee367e09957200e/CLAUDE.md
[verify-ai]: https://github.com/VerifyTests/Verify/blob/33.3.4/docs/ai-usage.md
[myra-mcp]: https://github.com/MyraUI/Myra/blob/1.6.7/src/Myra.Mcp/README.md
[mg-386]: https://github.com/MonoGame/MonoGame/releases
[gum]: https://github.com/vchelaru/Gum/releases
[xunit-400]: https://xunit.net/releases/v3/4.0.0
[c-monogame]: https://github.com/MonoGame/MonoGame
[c-monogame-native]: https://github.com/MonoGame/MonoGame/tree/v3.8.6/native/monogame
[c-monogame-windowsdx]: https://www.nuget.org/packages/MonoGame.Framework.WindowsDX
[c-fna]: https://github.com/FNA-XNA/FNA
[c-kni]: https://github.com/kniEngine/kni
[c-foster]: https://github.com/FosterFramework/Foster
[c-sadconsole]: https://github.com/Thraka/SadConsole
[c-osu-framework]: https://github.com/ppy/osu-framework
[c-nez]: https://github.com/prime31/Nez
[c-sdl3]: https://github.com/libsdl-org/SDL
[c-sdl3cs]: https://github.com/edwardgushchin/SDL3-CS
[c-ppy-sdl3]: https://github.com/ppy/SDL3-CS
[c-sdl3sharp]: https://github.com/flibitijibibo/SDL3-CS
[c-hexa-sdl3]: https://github.com/HexaEngine/Hexa.NET.SDL
[c-raylibcs]: https://github.com/raylib-cs/raylib-cs
[c-raylib-csharp]: https://github.com/MrScautHD/Raylib-CSharp
[c-silk]: https://github.com/dotnet/Silk.NET
[c-opentk]: https://github.com/opentk/opentk
[c-sfml]: https://github.com/SFML/SFML.Net
[c-veldrid]: https://github.com/veldrid/veldrid
[c-vortice-vulkan]: https://github.com/amerkoleci/Vortice.Vulkan
[c-vortice-windows]: https://github.com/amerkoleci/Vortice.Windows
[c-sharpdx]: https://github.com/sharpdx/SharpDX
[c-sharpmetal]: https://github.com/IsaacMarovitz/SharpMetal
[c-webgpusharp]: https://github.com/EmilSV/WebGPUSharp
[c-skiasharp]: https://github.com/mono/SkiaSharp
[c-slang]: https://github.com/shader-slang/slang
[c-shadercross]: https://github.com/libsdl-org/SDL_shadercross
[c-dxc]: https://github.com/microsoft/DirectXShaderCompiler
[roadmap-versions]: ../ROADMAP.md#versions
[c-clangsharp]: https://github.com/dotnet/ClangSharp
[c-c2cs]: https://github.com/bottlenoselabs/c2cs
[c-hexagen]: https://github.com/HexaEngine/HexaGen
[c-cppsharp]: https://github.com/mono/CppSharp
[c-cswin32]: https://github.com/microsoft/CsWin32
[c-miniaudio]: https://github.com/mackron/miniaudio
[c-hexa-miniaudio]: https://github.com/HexaEngine/Hexa.NET.MiniAudio
[c-miniaudioex]: https://github.com/japajoe/MiniAudioExNET
[c-sdl3-mixer]: https://github.com/libsdl-org/SDL_mixer
[c-openal-soft]: https://github.com/kcat/openal-soft
[c-faudio]: https://github.com/FNA-XNA/FAudio
[c-theorafile]: https://github.com/FNA-XNA/Theorafile
[c-soloud]: https://github.com/jarikomppa/soloud
[c-naudio]: https://github.com/naudio/NAudio
[c-managedbass]: https://github.com/ManagedBass/ManagedBass
[c-steamaudio]: https://github.com/ValveSoftware/steam-audio
[c-nvorbis]: https://github.com/NVorbis/NVorbis
[c-nlayer]: https://github.com/naudio/NLayer
[c-concentus]: https://github.com/lostromb/concentus
[c-ffmpegcore]: https://github.com/rosenbjerg/FFMpegCore
[c-fontstashsharp]: https://github.com/FontStashSharp/FontStashSharp
[c-stbtruetype]: https://github.com/StbSharp/StbTrueTypeSharp
[c-harfbuzzsharp]: https://www.nuget.org/packages/HarfBuzzSharp
[c-sdl3-ttf]: https://github.com/libsdl-org/SDL_ttf
[c-msdfgen]: https://github.com/Chlumsky/msdfgen
[c-sharpfnt]: https://github.com/AuroraBertaOldham/SharpFNT
[c-freetypesharp]: https://www.nuget.org/packages/FreeTypeSharp
[c-sixlabors-fonts]: https://github.com/SixLabors/Fonts
[c-stbimage]: https://github.com/StbSharp/StbImageSharp
[c-pfim]: https://github.com/nickbabcock/Pfim
[c-bcnencoder]: https://github.com/Nominom/BCnEncoder.NET
[c-libktx]: https://github.com/mcraiha/libktxsharp
[c-basisu]: https://github.com/BinomialLLC/basis_universal
[c-webp]: https://github.com/imazen/libwebp-net
[c-imagesharp]: https://github.com/SixLabors/ImageSharp
[c-dottiled]: https://github.com/dcronqvist/DotTiled
[c-tiledlib]: https://www.nuget.org/packages/TiledLib/5.3.0
[c-ldtkmonogame]: https://github.com/IrishBruse/LDtkMonogame
[c-asepritedotnet]: https://github.com/AristurtleDev/AsepriteDotNet
[c-monogame-aseprite]: https://github.com/AristurtleDev/monogame-aseprite
[c-sharpgltf]: https://github.com/vpenades/SharpGLTF
[c-assimpnetter]: https://github.com/Saalvage/AssimpNetter
[c-box2dnet]: https://github.com/ikpil/Box2D.NET
[c-aether]: https://github.com/nkast/Aether.Physics2D
[c-jitter2]: https://github.com/notgiven688/jitterphysics2
[c-bepu]: https://github.com/bepu/bepuphysics2
[c-joltsharp]: https://github.com/amerkoleci/JoltPhysicsSharp
[c-fixedmathsharp]: https://github.com/mrdav30/FixedMathSharp
[c-fixpointcs]: https://github.com/XMunkki/FixPointCS
[c-coremathsharp]: https://github.com/andanteyk/CoreMathSharp
[c-gum]: https://github.com/vchelaru/Gum
[c-hexa-imgui]: https://github.com/HexaEngine/Hexa.NET.ImGui
[c-imgui-net]: https://github.com/ImGuiNET/ImGui.NET
[imgui-net-508]: https://github.com/ImGuiNET/ImGui.NET/issues/508
[c-myra]: https://github.com/MyraUI/Myra
[c-apos-gui]: https://github.com/Apostolique/Apos.Gui
[c-avalonia]: https://github.com/AvaloniaUI/Avalonia
[c-monogame-extended]: https://github.com/MonoGame-Extended/Monogame-Extended
[c-apos-tweens]: https://github.com/Apostolique/Apos.Tweens
[c-spine]: https://github.com/EsotericSoftware/spine-runtimes
[c-staticecs]: https://github.com/Felid-Force-Studios/StaticEcs
[c-friflo]: https://github.com/friflo/Friflo.Engine.ECS
[c-moontools-ecs]: https://github.com/MoonsideGames/MoonTools.ECS
[c-arch]: https://github.com/genaray/Arch
[arch-315]: https://github.com/genaray/Arch/issues/315
[c-communitytoolkit]: https://github.com/CommunityToolkit/dotnet
[communitytoolkit-1138]: https://github.com/CommunityToolkit/dotnet/issues/1138
[c-zlinq]: https://github.com/Cysharp/ZLinq
[c-protobuf-net]: https://github.com/protobuf-net/protobuf-net
[c-messagepack]: https://github.com/MessagePack-CSharp/MessagePack-CSharp
[c-memorypack]: https://github.com/Cysharp/MemoryPack
[c-tomlyn]: https://github.com/xoofx/Tomlyn
[c-redox]: https://github.com/CAPCOM-TD-OSS/REDox
[c-sqlite]: https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/
[c-linguini]: https://github.com/Ygg01/Linguini
[c-messageformat]: https://github.com/jeffijoe/messageformat.net
[c-gettext]: https://github.com/perpetualKid/GetText.NET
[c-lua-csharp]: https://github.com/nuskey8/Lua-CSharp
[c-moonsharp]: https://github.com/moonsharp-devs/moonsharp
[c-jint]: https://github.com/sebastienros/jint
[c-wasmtime]: https://github.com/bytecodealliance/wasmtime-dotnet
[c-ink]: https://github.com/inkle/ink
[c-yarnspinner]: https://github.com/YarnSpinnerTool/YarnSpinner
[c-litenetlib]: https://github.com/RevenantX/LiteNetLib
[c-backdash]: https://github.com/Delta3-Studio/Backdash
[c-steamworks-net]: https://github.com/rlabrecque/Steamworks.NET
[c-facepunch-steamworks]: https://github.com/Facepunch/Facepunch.Steamworks
[c-discordrpc]: https://github.com/Lachee/discord-rpc-csharp
[c-butler]: https://github.com/itchio/butler
[c-dotrecast]: https://github.com/ikpil/DotRecast
[c-gorogue]: https://github.com/Chris3606/GoRogue
[c-fastnoiselite]: https://github.com/Auburn/FastNoiseLite
[c-opensimplex2]: https://github.com/KdotJPG/OpenSimplex2
[c-clipper2]: https://github.com/AngusJohnson/Clipper2
[c-debroglie]: https://github.com/BorisTheBrave/DeBroglie
[c-xunit]: https://github.com/xunit/xunit
[c-cscheck]: https://github.com/AnthonyLloyd/CsCheck
[c-benchmarkdotnet]: https://github.com/dotnet/BenchmarkDotNet
[c-awesomeassertions]: https://github.com/AwesomeAssertions/AwesomeAssertions
[c-tunit]: https://github.com/thomhurst/TUnit
[c-verify]: https://github.com/VerifyTests/Verify
[c-tracy]: https://github.com/wolfpld/tracy
[c-renderdoc]: https://github.com/baldurk/renderdoc
[c-netcoredbg]: https://github.com/Samsung/netcoredbg
[c-sentry]: https://github.com/getsentry/sentry-dotnet
[mg-tutorial-gum]: https://github.com/MonoGame/docs.monogame.github.io/blob/0e1a10af3622dc00a777058bd1d5f79711545d5e/articles/tutorials/building_2d_games/20_implementing_ui_with_gum/index.md
[ember]: https://github.com/MonoGame-Extended/Ember/blob/310192c44c84798eedb7b0d5e3f059fbcbe0c606/src/Ember/Ember.csproj
[osu-csproj]: https://github.com/ppy/osu-framework/blob/06e28ecb30f9136304a4cd8889550884bf05a346/osu.Framework/osu.Framework.csproj
[ss14-props]: https://github.com/space-wizards/RobustToolbox/blob/0ca6ad805868afd36021690629f3ca383623763b/Directory.Packages.props
[mge-1206]: https://github.com/MonoGame-Extended/Monogame-Extended/issues/1206
[devlayer-video]: ../DEVELOPMENT-LAYER.md#gameplay-video
[roadmap-after]: ../ROADMAP.md#after-01
[issue-85]: https://github.com/softhatgames/playstead/issues/85
[product]: ../PRODUCT.md
[issue-98]: https://github.com/softhatgames/playstead/issues/98
[issue-93]: https://github.com/softhatgames/playstead/issues/93
[codex-skills]: https://learn.chatgpt.com/docs/build-skills
[cc-skills]: https://code.claude.com/docs/en/skills
[anth-claude-api-skill]: https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/claude-api/SKILL.md
[openai-docs-skill]: https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/openai-docs/SKILL.md
[facepunch-releases]: https://github.com/Facepunch/Facepunch.Steamworks/releases
[sharpdx-repo]: https://github.com/sharpdx/SharpDX
[mg-4027]: https://github.com/MonoGame/MonoGame/issues/4027
[nuget-search]: https://github.com/NuGet/docs.microsoft.com-nuget/blob/2523f70766b2a6c6d4b32efd76ebe7b6697955f1/docs/api/search-query-service-resource.md
[nuget-reg]: https://github.com/NuGet/docs.microsoft.com-nuget/blob/2523f70766b2a6c6d4b32efd76ebe7b6697955f1/docs/api/registration-base-url-resource.md#catalog-entry
[osv-api]: https://google.github.io/osv.dev/post-v1-query/
[gh-rate]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[issue-90]: https://github.com/softhatgames/playstead/issues/90
[issue-97]: https://github.com/softhatgames/playstead/issues/97
