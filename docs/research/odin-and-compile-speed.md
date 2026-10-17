# Odin, and languages that compile fast

- **Question:** Does Odin suit Playstead as a second supported stack beside C#, and which languages give games the fastest edit-to-see loop ([#103][ticket])? The founder's Rust game, Handbuilt, loses minutes to Rust's compile times. Playstead 0.1 stays on C# with MonoGame DesktopGL ([ADR 0004][adr-0004]); this research is for after 0.1.
- **Date:** 2026-10-17. All sources were accessed on this date.
- **Outcome:** Odin compiles fast, but C#'s Hot Reload gave the fastest loop measured, and Odin misses one of 0.1's six desktops. On generated games of about 100,000 lines, an Odin development build took 0.5 s whether clean or after a one-line change, and the change reached the running game through a reloaded library in 0.52 s with its game state kept. C# rebuilt in 1.3 s, but Hot Reload showed the change in 0.09 s. Rust rebuilt in 1.1 s and showed the change after a restart in 1.3 s, losing its game state; Handbuilt's own log shows 4.5 to 7.7 s for a test build. Against Odin: no Windows arm64 target, optimised builds on one thread (6.9 s at 100,000 lines), a library reload that crashed on the seventh reload on macOS until the library exported only its game procedures (a newer third-party patcher, Livepatch, changes code in place as Hot Reload does, but only on Windows and Linux x64), about five breaking changes a month, and a 1.0 in January 2027 that fixes the language but not its libraries. A recommendation; the founder decides: keep C# as the only supported stack through 0.1; record Odin in the roadmap's "After 0.1" as the first candidate for a second stack, added when a real game needs it and once Odin has a Windows arm64 target and the fix in [PR #7911][odin-pr-7911]; and leave Zig, Go, C and Jai aside for the reasons [below](#other-fast-compiling-candidates).
- **Versions:** Odin `dev-2026-10` (commit `84bc3fc`, 2026-10-06, LLVM 20.1.8) with `vendor:raylib` 6.0 ([release][odin-release]). .NET SDK 10.0.103 (runtime 10.0.3) with MonoGame 3.8.6. rustc 1.98.1 with macroquad 0.4.16; 1.99.1 is current ([releases][rust-releases]). Apple clang 21.0.0 and Go 1.26.2 for small probes only. Zig 0.17.0, Go 1.27.2, Ebitengine 2.10.5, raylib 6.2 and SDL 3.4.18 from their own documentation.
- **Local evidence:** an Apple M3 Max (10 performance and 4 efficiency cores, 36 GB) with macOS 26.6.2, in a scratch folder under `/tmp` that was then deleted, with every download and cache inside it. The same small 2D game was written in C#, Odin and Rust, then grown with generated gameplay code to about 10,000, 50,000 and 100,000 lines. Codex and Claude each wrote the game in Odin. The Mac's screen stayed locked; a script kept its display awake so that windows could open behind the lock screen. These results are marked **Observed**.

Labels: **Documented** (official documentation, repositories, source code or release notes), **Observed** (the local runs), **Inference** (reasoning, not a source) and **Unconfirmed** (not established).

## Compile speed

### What was measured

- **The game (Observed).** A window, a 32-pixel sprite moved by the arrow keys, and a simulation of 400 entities at 60 ticks per second with a check between every pair of entities, in its own module that draws nothing. Odin uses raylib from `vendor:`, C# uses MonoGame and Rust uses macroquad. The small versions are 328, 243 and 225 lines. All nine builds of the simulation, in three languages and at every optimisation level, ended 3,000 ticks with the same fingerprint.
- **The larger programs (Observed).** A generator added the same gameplay code in each language: 56, 288 and 578 kinds of entity, each with its own state, update, helpers and tint, all run every tick. Odin and Rust reach about 10,000, 50,000 and 100,000 lines; C#'s braces on their own lines make it 12,170, 62,058 and 124,181 lines. The one-line change edits the tint of one kind. The code has no generics, traits or macros, and the 10,000-line versions computed the same game state in all three languages.
- **Builds (Observed).** Development builds are C# `Debug`, Odin `-debug` and Rust's `dev` profile; optimised builds are C# `Release`, Odin `-o:speed` and Rust at `opt-level = 2`, as Handbuilt's tests use. A clean build starts with no build outputs but with dependencies downloaded. C#'s build servers stayed warm, and sccache was off. Figures are medians of 3 to 10 runs.

### The results

Seconds, medians (**Observed**):

| Program | Stack | Clean build | No-op build | One-line rebuild | One-line, optimised | Save to frame |
| ------- | ----- | ----------- | ----------- | ---------------- | ------------------- | ------------- |
| Small   | C#    | 0.62        | 0.47        | 0.49             | 0.49                | 0.06          |
| Small   | Odin  | 0.27        | 0.27        | 0.27             | 0.98                | 0.30          |
| Small   | Rust  | 2.24        | 0.04        | 0.22             | 0.33                | 0.42          |
| 10k     | C#    | 0.70        | 0.46        | 0.57             | 0.57                | 0.07          |
| 10k     | Odin  | 0.29        | 0.30        | 0.30             | 1.46                | 0.33          |
| 10k     | Rust  | 2.33        | 0.04        | 0.36             | 0.47                | 0.58          |
| 50k     | C#    | 1.03        | 0.50        | 0.90             | 0.92                | 0.08          |
| 50k     | Odin  | 0.37        | 0.37        | 0.38             | 3.69                | 0.40          |
| 50k     | Rust  | 3.46        | 0.04        | 0.72             | 1.76                | 0.96          |
| 100k    | C#    | 1.51        | 0.50        | 1.33             | 1.35                | 0.09          |
| 100k    | Odin  | 0.50        | 0.49        | 0.49             | 6.85                | 0.52          |
| 100k    | Rust  | 4.79        | 0.05        | 1.05             | 3.60                | 1.28          |

Save to frame is the time from saving the one-line change to the first frame drawn with it, through each stack's reload path: Hot Reload under `dotnet watch` for C#, the game built as a library and reloaded by a host for Odin, and a rebuild and restart for Rust. For Odin and Rust the measuring script started the build as soon as it saved; a file watcher would add its own delay.

- **Odin rebuilds everything (Documented, Observed).** Every build parses and type-checks every file of every imported package, generates code for everything reachable and links; nothing is kept between builds ([main.cpp][odin-main-pipeline]). So clean, no-op and one-line builds take the same time. At 100,000 lines a `-debug` build spent 26 ms parsing, 40 ms type-checking, 199 ms generating code in 119 modules in parallel, and 205 ms linking, including `dsymutil` (**Observed**, `-show-timings`).
- **Odin's optimised builds use one thread (Documented, Observed).** Separate modules, and so parallel code generation, are the default only for `-o:none` and `-o:minimal`; `-o:speed` builds one module ([build_settings.cpp][odin-separate-modules]). At 100,000 lines code generation took 6.6 of its 6.8 s. The default, `-o:minimal`, built in 0.33 s.
- **No cache and no incremental compilation (Documented, Observed).** The hidden `-internal-cached` flag reuses the previous executable only when nothing has changed; Odin's creator calls it "extremely dumb" and "not meant to be used by anyone" ([discussion #5409][odin-disc-5409]). Here it failed a compiler assertion on every cache hit. The Tilde backend, the only attempt at a backend other than LLVM, was removed on 2026-03-26 ([PR #6483][odin-pr-6483]). The October release concentrated on compile time, with a multithreaded checker and faster code generation ([dev-2026-10][odin-release]).
- **C# (Observed).** A one-line rebuild grew from 0.49 s to 1.33 s with size, and a no-op build stayed at 0.5 s. Hot Reload showed a change in 60 to 90 ms at every size; the first change of each session took 0.7 to 0.9 s.
- **Rust (Observed, Documented).** Incremental one-line rebuilds grew from 0.22 s to 1.05 s, and to 3.6 s at `opt-level = 2`. Clean builds took 2.2 to 4.8 s, and 8.9 s optimised. The generated code flatters Rust. Handbuilt's own log, `docs/iteration-speed.md` in its private repository (commit `d9ab540`, 2026-10-13), records 4.5 to 7.7 s for a test build after a one-line edit, about 105 s for a cold build with sccache, and 3.5 GB in each worktree's `target`.
- **Disk (Observed).** At 100,000 lines the Rust `target` folder held 715 MB for two profiles, C#'s `bin` and `obj` 77 MB, and Odin's outputs 14 MB.

### How fast unoptimised builds run

Milliseconds for 3,000 ticks of the small game's simulation, medians of five runs (**Observed**):

| Stack | Unoptimised                                             | Optimised                             | Slowdown  |
| ----- | ------------------------------------------------------- | ------------------------------------- | --------- |
| C#    | 597 (`Debug`)                                           | 173 (`Release`)                       | 3.5×      |
| Odin  | 1,216 (`-o:none`, as with `-debug`); 726 (`-o:minimal`) | 90 (`-o:speed`); 91 (`-o:aggressive`) | 13.5×; 8× |
| Rust  | 4,673 (`dev`)                                           | 133 (`opt-level = 2`); 84 (`release`) | 56×       |

- **Inference.** Long scripted plays and logic tests need optimised builds in Rust, as Handbuilt found, and probably in Odin. In Odin that cost grows with the game: 6.9 s to build at 100,000 lines. `-o:minimal` is a middle ground, the fastest to build and 1.7× faster to run than `-o:none`.
- **C# (Documented, Observed).** Hot Reload applies only in `Debug` ([.NET library note][dotnet-note]), so the preview runs `Debug` code, here 3.5× slower than `Release`. A `Release` build compiled as fast as a `Debug` one.

## Code reload in a running game

- **What Odin provides (Documented).** `core:dynlib` loads a library, finds its symbols and unloads it; `initialize_symbols` fills a struct of procedure pointers, and calling it again unloads the previous library, "allowing for straightforward hot reload support" ([lib.odin][odin-dynlib]). Odin's documentation has no hot-reload guide. Karl Zylinski's template is the working pattern: a host executable that owns the window and the game memory, a game library rebuilt and loaded under a new name, raylib linked as a shared library, and a full reset when the memory's size changes ([template][zylinski-template]).
- **What it keeps (Observed).** The host built here kept the window, the textures and the game state across every reload; the entities carried on from where they were. The host checks the library's modification time each frame, copies the new build and hands the existing memory to the new code.
- **A crash on the seventh reload (Observed).** With default flags the host stopped on the seventh reload, every time, with "There are no more thread-local cleaner slots available". The runtime keeps eight slots ([thread_management.odin][odin-tl-cleaners]), and each loaded library's `core:os` takes one ([allocators.odin][odin-os-cleaner]). Both the host and each library defined that table as a weak external symbol (`nm`); in separate-module builds, the default for development, Odin gives globals weak linkage ([PR #7911][odin-pr-7911]), and macOS's loader evidently bound every copy to the host's table (**Inference**). Exporting only the game's procedures (`-extra-linker-flags:-Wl,-exported_symbol,_game_*`) kept each copy's table private: 20 reloads without a fault. `-use-single-module` also worked, but the library then took 1.71 s to build at 100,000 lines instead of 0.47 s. The open PR #7911 would hide these globals by default. Linux and Windows were not tested (**Unconfirmed**).
- **Libraries are never unloaded on macOS (Documented, Observed).** Apple's `dlclose` never unloads a library with thread-local variables ([dlclose(3)][apple-dlclose]), and every Odin library has some, such as the runtime's temporary allocator (`nm`). Each reload must load a new file name, and every reloaded copy stays in memory until the run ends; how fast that grows is **Unconfirmed**.
- **What forces a restart (Documented, Inference).** A change in the host needs a restart. A change to the size of the game memory resets the game state without closing the window; a layout change that keeps the size goes undetected and misreads memory (**Inference**). Globals in the library start fresh on every load, and pointers to string literals or procedures in old copies stay valid only while those copies stay loaded ([template][zylinski-template]). On Windows a library's initialisers run under the loader lock and must not start threads ([DLL best practices][ms-dll-practices]).
- **A layout change (Observed).** When one save also added a field to the entity struct, Odin's host reset the game state in the running process in 0.30 s. `dotnet watch` reported "Restart is needed to apply the changes" and restarted the C# game in 1.35 s, losing its game state.
- **Livepatch, patching in place (Documented).** A third-party package, first published on GitHub on 2026-09-17, changes a running Odin program without a library split ([forum][livepatch-forum]). Its `patch()` runs the game's build script to compile object files, links them into a patch module, binds them to the running program's globals by name and redirects each procedure to its new body; the next call runs the new code. Globals and `@(static)` locals keep their values, so the window and the game state stay where they are. Migration hooks receive the types whose layout changed, so a game can move its state into the new layout instead of resetting it. It pauses every other thread for "a few milliseconds", works at `-o:speed`, keeps breakpoints working in the new code, and compiles to nothing without `-define:LIVEPATCH=true` ([README][livepatch-readme]).
- **Livepatch's limits (Documented).** It runs only on Windows and Linux x64, and its author calls it a work in progress: "Expect crashes and breaking changes" ([README][livepatch-readme]). It needs Odin's master branch, because it relies on compiler fixes its author merged after `dev-2026-10` ([PR #7845][odin-pr-7845]). `main` keeps its old body, a global stored by value cannot change its layout, a stored `typeid` or `any` keeps the old type information, and old code stays in memory until a restart. A patch cannot call a raylib procedure that the first build did not use ([example][livepatch-example]). Support for Apple Silicon is in progress on a branch whose checks fail ([macos-arm][livepatch-macos]). It was not run here, so its speed is **Unconfirmed**; each patch rebuilds every procedure, so it should cost about what the library reload costs (**Inference**).
- **C#'s Hot Reload (Documented).** It applies most edits inside method bodies and many additions, but adding a field to a struct, changing an interface or adding a virtual member needs a restart ([supported edits][roslyn-enc]). A changed method takes effect on its next call, which in a game loop is the next frame.
- **Comparison (Inference).** C# applies the common edit, a change inside a method, about five times faster than Odin, in the same process. Odin applies any edit inside the game library, including those C# cannot, such as changes to an interface or a base type, and answers a layout change by resetting the game state in place, where C# restarts the process. Livepatch would bring Odin closest to C#'s model, a single process patched in place, with migration hooks C# lacks, once it reaches macOS and arm64 and matures.

## The game structure

### State and snapshots

- **Copies are shallow (Documented).** Slices, dynamic arrays and maps are "normal structures with pointer fields", and copying one, as when passing it, leaves its elements where they are ([overview][odin-overview-copy]). A string is a pointer and a length too ([core.odin][odin-raw-types]).
- **Pointer-free state (Documented, Observed).** Odin has value types that store their elements inline: fixed arrays, `#soa[N]T`, `[dynamic; N]T` (since dev-2026-04) and `Static_Handle_Map` (since dev-2026-02) ([handle_map][odin-handle-map]). A seeded random state is 1,040 bytes with no pointers (**Observed**).
- **Inference.** Game state kept in one pointer-free struct can be snapshotted by one assignment. That needs capacities chosen in advance and handles in place of pointers.
- **Maps cannot be copied (Documented, Observed).** A map's hash seed comes from the address of its storage ([dynamic_map_internal.odin][odin-map-seed]). A map byte-copied to another address found none of its 20 keys.
- **Portable snapshots (Documented).** `core:encoding/cbor` serialises almost every type through its type information, matches struct fields by name when reading and has a fully deterministic encoding; it does not follow pointers ([cbor][odin-cbor]). `#relative` pointer types were removed in dev-2024-12 in favour of `core:relative` ([commit][odin-relative-removed]).

### Replay across desktops

- **Fused multiply-add (Observed, Documented).** Odin compiled plain `a*b + c` without fusing it at every optimisation level, on arm64 and x64, and the fingerprints above agree with C# and Rust. But the overview allows fusion ([overview][odin-overview-fusion]), so this is the compiler's behaviour, not a promise. Built-in matrix products and `math.fmuladd` do fuse on arm64 and not on x64's default `x86-64-v2`: the same expression gave `0x32800000` on arm64 and `0` on x64 under Rosetta. The `@(fast_math)` attribute is broken in this release; the fix landed a day later ([PR #7068][odin-pr-7068]).
- **Maths functions (Documented, Observed).** `math.sin`, `cos`, `tan`, `pow` and `exp` become LLVM intrinsics that call the platform's C maths library ([math_basic.odin][odin-math-basic]). Between macOS arm64 and x64 under Rosetta, 36,474 of 200,000 `sin(f64)` results differed. `sincos`, `ln`, `atan2`, `asin`, `acos`, `floor`, `round` and `mod` are written in Odin; `sincos`, `ln` and `atan2` matched bit for bit.
- **Map order (Observed).** Iterating the same map, built the same way, gave a different order on every run, because of the address seed.
- **Randomness (Documented, Observed).** `rand.create(seed)` gave the same sequence on arm64 and x64. The default algorithm changed to ChaCha8 in dev-2025-12, marked "BREAKING" ([dev-2025-12][odin-dev-2025-12]), so a game should pin its compiler or keep its own generator (**Inference**).
- **Other rules (Documented).** Integer overflow wraps by definition ([overview][odin-overview-overflow]). An out-of-range conversion from float to integer gives a different value on each run at `-o:speed` ([issue #7248][odin-issue-7248]).
- **C# and Rust, for comparison (Documented, Observed).** RyuJIT did not fuse `a*b + c` on arm64, but `System.Numerics.Vector2.Lerp` calls `MultiplyAddEstimate`, which may fuse ([Vector2.cs][dotnet-vector2-lerp]); 23 `Math` methods, `Sin` and `Pow` among them, call the C runtime ([Math.Sin][dotnet-math-sin]). rustc never fuses implicitly ([RFC 3514][rust-rfc-3514]), and std documents `sin` and `powf` as platform-dependent ([f64][rust-f64-sin]).
- **Inference.** In all three languages the simulation needs its own trigonometry and powers, a defined iteration order and a generator it owns. Odin adds two hazards: matrix types and `fmuladd` must stay out of the simulation, and since the language permits fusion, a check should read the generated code as well as the source.

### Physics

- **Box2D (Documented).** `vendor:box2d` is Box2D 3.1.1 ([dev-2026-01][odin-dev-2026-01]). Box2D has had cross-platform determinism since 3.1, through compiler flags that stop fusion and its own trigonometry ([simulation][box2d-simulation]), "However, Box2D does not have rollback determinism" ([FAQ][box2d-faq]). Snapshot and restore exist only on Box2D's unreleased main branch ([Replay][box2d-replay]). Odin ships no Box2D library for Linux ([box2d.odin][odin-box2d]).
- **Observed.** The macOS Box2D libraries in `vendor:` contain no fused instructions. `vendor:box3d` is built without `-ffp-contract=off`, against Box3D's own rules, and its arm64 library contains 5,257 fused instructions.
- **GGPO (Documented).** `vendor:ggpo` links a Windows library added in 2022 and never updated ([ggpo.odin][odin-ggpo]).
- **Inference.** With 3.1.1 a Box2D world can be replayed only from its start; a snapshot means rebuilding the world from game data, or waiting for Box2D 3.2. Simple physics written in Odin with plain arithmetic, `sqrt` and `sincos` lives in the snapshot with the rest of the game state.

## A Playstead library for Odin

- **Frames (Documented).** `core:net` has TCP and UDP on Windows, Linux and macOS, and `core:sys/posix` and `core:sys/windows` bind shared memory ([net][odin-net]). raylib reads a render texture back with `LoadImageFromTexture`, which waits for the GPU every frame; SDL3's GPU API downloads asynchronously ([rtextures.c][raylib-readback], [SDL_gpu.h][sdl-gpu-download]).
- **Input (Documented).** raylib's `PlayAutomationEvent` writes key, mouse and touch events into its input state, but gamepads are read again every frame ([rcore.c][raylib-automation]). `SDL_PushEvent` does not change the state that games poll ([SDL_events.h][sdl-push-event]). **Inference:** the input mapping should read one input value per tick, built by the host from the device or the preview.
- **Inspection (Documented).** Type information is always present in desktop builds ([build_settings.cpp][odin-no-rtti]). `core:reflect` gives each struct field's name, type, offset and tags, and walks enums, unions, arrays and maps ([reflect.odin][odin-reflect]). **Inference:** field tags can carry the units, ranges and content origins that the game's description of its state needs.
- **Content reload (Documented).** `core` has no file watcher; polling modification times works everywhere, and inotify, kqueue and `ReadDirectoryChangesW` are bound for a native watcher ([stat.odin][odin-os-stat]). `core:encoding` reads JSON, JSON5, CBOR, INI, CSV and XML.
- **Release builds (Documented, Observed).** Build tags cannot test `-define` values, and `import` is not allowed inside `when` ([parser.cpp][odin-build-tags]). An imported package's `@(init)` code is linked even if nothing uses it. **Inference:** the development layer belongs in packages that only a development entry point imports, as the template's host is, and a release check can fail on any such file that `-export-dependencies:json` lists.
- **Logic tests (Documented).** `odin test` runs tests on several threads, tracks memory per test and can write a JSON report ([testing][odin-testing]).
- **Tooling (Documented).** `-json-errors` prints machine-readable errors, `odin check` type-checks without building, and `-vet` adds checks. The language server and formatter, ols, is maintained outside the Odin project and follows its master branch ([ols][ols]).

## Platforms

- **Compilers (Documented, Observed).** `dev-2026-10` ships compilers for Linux x64 and arm64, macOS arm64 and Windows x64 ([release][odin-release]). It is the first release without a macOS x64 compiler: Intel Macs left Odin's CI and releases in September 2026, though the `darwin_amd64` target stays ([newsletter][odin-news-2026-09]). No release has shipped a Windows arm64 compiler, and `build.bat` builds only for x64 ([build.bat][odin-build-bat]). On Windows, Odin needs Visual Studio's C++ tools and the Windows SDK ([install][odin-install]).
- **Windows on Arm (Documented).** There is no `windows_arm64` target; a maintainer wrote on 2026-10-03, "There is no `-target:windows_arm64` as of yet" ([issue #6686][odin-issue-6686]). **Inference:** an Odin game reaches Windows arm64 only as an x64 program under emulation, short of 0.1's native builds for six desktops. Whether Odin's x64 compiler runs there is **Unconfirmed**.
- **Cross-compiling (Documented, Observed).** Odin generates code for other operating systems but does not link it: "Linking for cross compilation for this platform is not yet supported" ([linker.cpp][odin-cross-link]). The exceptions are Android through its NDK, an experimental Windows path that needs a downloaded Windows SDK, and both architectures on one Mac. **Inference:** each desktop export needs a build machine of that operating system, where C# exported all six from one Mac ([#84][ticket-84]).
- **Desktop exports (Documented, Observed).** raylib links statically on all three desktops, and Windows builds carry their C runtime, so a raylib game can ship as one executable ([raylib.odin][odin-raylib-link], [linker.cpp][odin-crt]); the optimised small game was 1.1 MB on macOS. SDL3 must be shipped with the game on macOS and Linux, where Odin links the system's copy ([sdl3][odin-sdl3-link]). On macOS a build records the build machine's macOS as its minimum unless `-minimum-os-version` is given ([issue #4966][odin-issue-4966]); here that was macOS 26. Odin makes no app bundles and signs nothing for desktops; `odin bundle` handles only Android.
- **Phones (Documented).** Android arrived as "VERY Rudimentary support" in dev-2025-04, with `odin bundle android` ([dev-2025-04][odin-dev-2025-04]). iOS subtargets arrived in dev-2025-08, without bundling or signing ([dev-2025-08][odin-dev-2025-08]). odin-lang.org has no guide for either.
- **The web (Documented).** The `js_wasm32` target runs in the browser with WebGL or WebGPU ([wasm][odin-wasm]). raylib or SDL3 in the browser needs Emscripten, which Odin supports through library overrides but does not document ([PR #4647][odin-pr-4647], [PR #7320][odin-pr-7320]).
- **Consoles (Unconfirmed).** No first-party statement about Nintendo, PlayStation or Xbox was found. A Playdate subtarget arrived in dev-2026-07 ([dev-2026-07][odin-dev-2026-07]).

## Libraries

- **In `vendor:` (Documented).** raylib 6.0 (6.2 is current upstream), SDL 3.4.2 with SDL3_image, SDL3_ttf and SDL3_mixer, GLFW 3.4, miniaudio 0.11.24, stb, fontstash, kb_text_shape, Box2D 3.1.1, microui, nanovg, OpenGL, Metal, Direct3D 11 and 12, Vulkan, wgpu-native 29 and ENet ([vendor][odin-vendor]). sokol's author keeps generated Odin bindings separately ([sokol-odin][sokol-odin]).
- **Prebuilt files (Documented, Observed).** raylib ships for macOS (universal), Windows x64 and Linux x64 and arm64; raygui has no Linux arm64 build. SDL3 comes from the system on macOS and Linux and ships only for Windows. Box2D has no Linux library, miniaudio and kb_text_shape must be built from source on macOS and Linux, and stb on Linux ([vendor][odin-vendor]).
- **Inference.** For 2D games, raylib covers drawing, sound, input and fonts on all three desktops, which makes it the natural first library for an Odin stack.

## Agents

- **The test (Observed).** Codex (GPT-6.1-Sol) and Claude (Opus 5.5), each at its default effort, wrote the small game in Odin with a reloadable library, from a short brief and the local Odin sources, with no skills. Claude's code built first time with `-vet` on. Codex's failed once, on two errors from the new `core:os`: `read_entire_file` now needs an allocator and returns an error, not a boolean. Both games reloaded once with their state and window kept. Both checked APIs in Odin's own source and used no web pages.
- **Ten reloads (Observed).** Claude's host then crashed on the seventh reload with the panic described above. Codex's survived all ten, because its library imported no `core:os`. Neither agent knew of the crash.
- **Breaking changes (Documented).** The release notes from dev-2025-01 to dev-2026-10 list about 107 changes that can break code, four to five a release: 74 changed or removed interfaces and 33 stricter checks, by this research's own count ([releases][odin-releases]). The largest replaced `core:os` in dev-2026-03: allocators became explicit, errors became `os.Error` and files `^os.File`, and the old package was deleted in dev-2026-09 ([core:os][odin-news-core-os]). Some removals had two years' warning; others were renames with no alias, and old `//+build` tags are now silently ignored.
- **Training data (Observed).** GitHub's search found 8,369 public Odin repositories, against 39,361 for Zig and 7,766,218 for C#. 46% of the Odin repositories are less than a year old, so older models mostly saw interfaces that have since changed (**Inference**).
- **Help for agents (Documented, Observed).** `odin check` with `-json-errors` gives machine-readable errors with "Did you mean" hints, and `odin test` can write a JSON report. odin-lang.org has no `llms.txt` or guidance for AI tools, and Odin's creator has called AI-generated code "AI slop" ([forum][odin-forum-slop]).
- **What skills would teach (Inference).** The pinned compiler and its `core:os`; the opt-in features (`using`, dynamic literals, `@(init)` with a context); the reload host with its export list; the replay rules above (no platform maths, no matrix types or `fmuladd`, no iteration over maps, a pointer-free root); `-minimum-os-version` on macOS and `-subsystem:windows` on Windows; and running `odin check -vet -json-errors` after every edit.

## Maturity

- **Releases (Documented, Observed).** Odin publishes monthly tags named `dev-YYYY-MM`, 23 of them in the 22 months from January 2025, with no versioning or stability promise ([releases][odin-releases]). "Odin as a language is pretty much done, but Odin the compiler, toolchain, and core library are still in development" ([FAQ][odin-faq-roadmap]).
- **1.0 (Documented).** Odin's creator, Ginger Bill, announced 1.0 for January 2027 ([video][odin-video]); it is "just the milestone for the language itself, not the core library, vendor library, etc." ([forum][odin-forum-2027]).
- **Licence (Documented).** zlib since dev-2025-11, previously BSD 3-clause ([LICENSE][odin-license]). `vendor:` libraries keep their own licences, mostly zlib, MIT or public domain ([vendor README][odin-vendor-readme]).
- **Who maintains it (Documented, Observed).** "Ginger Bill is BDFL and significant changes _must_ be passed by him" ([proposal process][odin-proposal]). In the last year two people made 1,050 of the 1,144 merges into `master`. JangaFX calls Odin its "Language of Choice" ([JangaFX][jangafx]). GitHub Sponsors shows 59 sponsors and a monthly goal of $5,000, 18% met (**Observed**).
- **Community (Observed).** 12,154 GitHub stars, about 11,100 members on the official Discord, and 177 active users on the official forum in the last 30 days.
- **What ships in it (Documented).** JangaFX's EmberGen and other tools, and a few small commercial games: odin-lang.org lists eight released on Steam, among them CAT & ONION on Windows, macOS and Linux and Solar Storm on Windows ([games][odin-games]).

## Other fast-compiling candidates

### Zig

- **Release (Documented).** 0.17.0 came out on 2026-10-01; Zig is before 1.0 and every recent release broke code ([0.17.0][zig-0170]). It is MIT-licensed ([LICENSE][zig-licence]) and funded by a non-profit foundation ([finances][zig-finances]).
- **Compile speed (Documented).** Zig's own x86_64 backend compiles debug builds about five times faster than LLVM ([0.15.1][zig-0151]), but it is the default only on Linux x64 and macOS x64. Debug builds on macOS arm64, Linux arm64 and Windows still go through LLVM; the arm64 backend "crashes" on Zig's tests ([0.16.0][zig-0160]). Incremental rebuilds of 50 to 70 ms work only when targeting Linux x64 ([0.17.0][zig-0170], [incremental][zig-incremental]).
- **Reload (Documented).** Hot code swapping has been an open issue since 2016 ([#68][zig-hcs]). `std.DynLib` lost Windows support in 0.16.0 ([0.16.0][zig-0160]).
- **Replay (Documented).** Floating-point operations are strict by default, so nothing fuses unless asked ([setFloatMode][zig-floatmode]). `ArrayHashMap` keeps insertion order.
- **Platforms (Documented).** Zig ships compilers for all six desktops but marks x64 macOS as "expected to be removed eventually" ([0.17.0][zig-0170]). raylib maintains its own `build.zig`.
- **Agents (Documented).** 0.15 rewrote the I/O interfaces, 0.16 passed I/O explicitly to everything that needs it, and 0.17 removed `@cImport` ([0.15.1][zig-0151], [0.16.0][zig-0160], [0.17.0][zig-0170]). Zig refuses AI-written issues and patches ([README][zig-readme]).

### C

- **Stability and platforms (Documented).** C changes slowly. raylib 6.2 and SDL 3.4 ship builds for all six desktops, Windows arm64 included ([raylib 6.2][raylib-62], [SDL][sdl-releases]). SDL's console ports are separate forks for developers under the console makers' agreements ([platforms][sdl-platforms]).
- **Compile speed (Documented).** TinyCC "Compiles and links about 10 times faster than 'gcc -O0'", but its macOS arm64 and Windows arm64 support exists only on an unreleased branch ([README][tinycc]).
- **Reload (Inference).** The language has none; a game library loaded by a host works on every desktop, under the same macOS rule against unloading libraries with thread-local variables.
- **Replay (Documented, Observed).** clang fuses `a*b + c` by default ([clang][clang-fp-contract]); Apple clang 21 did so on arm64 even at `-O0`, and not for x64 at its default level. MSVC stopped fusing by default in Visual Studio 2022 ([/fp][msvc-fp]). Microsoft and SDL both say their maths functions can give different results on different machines ([CRT][msvc-crt-math], [SDL_stdinc.h][sdl-sin]). **Inference:** every file needs `-ffp-contract=off`, and the simulation its own maths.

### Go with Ebitengine

- **Compile speed (Documented).** Go caches each compiled package ([go help cache][go-cache]), and its FAQ says it "should take at most a few seconds to build a large executable on a single computer" ([FAQ][go-faq]).
- **Reload (Documented).** Ebitengine has no hot reload, and Go plugins cannot be unloaded and do not work on Windows ([plugin][go-plugin]).
- **Replay (Documented, Observed).** The specification lets the compiler fuse operations "possibly across statements" ([spec][go-spec-fma]). Go 1.26.2 fused `x*y + z` on arm64 even in unoptimised builds, and not on x64 at its default level; only an explicit conversion around each product stops it. The `math` package "does not guarantee bit-identical results across architectures" ([const.go][go-math-const]), and map order is randomised on purpose.
- **Platforms (Documented).** Ebitengine 2.10.5 runs on desktops, phones and the web, and on Nintendo Switch for developers with Nintendo's agreement ([Switch][ebitengine-switch]); its Xbox support is "limited and not available to everyone" ([README][ebitengine-readme]).
- **Driving a game from outside (Documented).** Ebitengine 2.10 adds an experimental host that runs a game headless, sends it input, advances it by ticks and captures its frames, with testing by an AI agent as one stated use ([2.10][ebitengine-210]). It overlaps with Playstead's development layer.

### Jai

- **Unconfirmed.** Jai is not publicly available, as far as first-party sources show. The only traces are a closed "programming language beta" ([post][jai-beta]) and Thekla's promise to release its engine, not the compiler, as open source after its game ([press release][jai-engine]). The game came out on 2026-10-08 ([Steam][jai-game]), and nothing has been announced since.

## Cost to Playstead

- **A second Playstead library (Inference).** The [development layer](../DEVELOPMENT-LAYER.md)'s foundation again, in Odin: frames from a render texture over shared memory or TCP, actions through input the host builds, the revision, inspection through `core:reflect`, snapshots of a pointer-free root and CBOR, action timelines, pausing and stepping, and content reload by polling, with the checks every Playstead library ships. Code reload adds the host, the export list, a check of the memory layout and a policy for memory that macOS never frees.
- **The replay check (Inference).** C#'s check can be a Roslyn analyser; Odin has no analyser hooks. `core:odin/parser` gives a syntax tree without types, so the check would combine rules on the source with a scan of the generated code for fused instructions and calls into the C maths library.
- **Skills (Inference).** Odin and its current `core:`, raylib from `vendor:`, the game structure's rules, the reload pattern and the build flags for each platform, revised at every compiler update the stack adopts.
- **A template (Inference).** A host, a game library, a release entry point and build scripts for each desktop, with one compiler release pinned per game. Playstead would find and install Odin as it does .NET.
- **CI and export (Inference).** Odin's compiler runs natively on four of the six desktops. Windows arm64 has neither a compiler nor a target, macOS x64 builds must come from an arm64 Mac, and every other export needs a runner of its own operating system. The macOS bundle and its signing are Playstead's work, as for C#.
- **Overall (Inference).** Roughly the C# stack's work again, plus the gaps above. ADR 0004 adds a stack only when a real game needs it.

## Comparison

| Stack                 | Edit to see, 100,000 lines                                    | Code reload                                                                                                    | Replay hazards                                                  | Desktops                                               | Phones, web, consoles                                   | Stability for agents                                              |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------- |
| C# with MonoGame      | 0.09 s by Hot Reload; 1.3 s rebuild (**Observed**)            | In the process; restarts for struct layout changes                                                             | C runtime maths; `Vector2.Lerp` may fuse                        | All six                                                | Phones; web planned; consoles through MonoGame          | Stable, and the most code to learn from                           |
| Odin with raylib      | 0.52 s by library reload; 0.5 s build (**Observed**)          | Library reload; state reset on layout change; crash fix needed. Livepatch in place, Windows and Linux x64 only | C runtime maths; matrix types and `fmuladd` fuse on arm64; maps | No Windows arm64; no x64 Mac compiler                  | Phones early; web without raylib docs; consoles unknown | About five breaking changes a month; 1.0 for the language in 2027 |
| Rust with macroquad   | 1.3 s rebuild and restart (**Observed**); Handbuilt 4.5–7.7 s | None built in                                                                                                  | Platform maths in std                                           | Three systems; arm64 Windows and Linux **Unconfirmed** | Phones and web; no public console route                 | Stable language                                                   |
| Zig with raylib       | Not measured; 50–70 ms incremental only for Linux x64         | None; library loading lost Windows                                                                             | Strict floats by default                                        | Compilers for all six; x64 Mac obsolescent             | Phones and web partly; consoles as targets only         | Breaks every release; refuses AI contributions                    |
| C with raylib or SDL3 | Not measured; TinyCC about 10× faster than `gcc -O0`          | By hand, through a host                                                                                        | clang and GCC fuse by default; libm differs                     | All six                                                | Phones and web; SDL consoles under agreement            | Stable, and agents know it well                                   |
| Go with Ebitengine    | Not measured; cached per package                              | None                                                                                                           | Fuses on arm64 even unoptimised; `math` differs; maps random    | All six built; arm64 untested upstream                 | Phones, web, Switch                                     | Go 1 promise                                                      |
| Jai                   | Not available                                                 | **Unconfirmed**                                                                                                | **Unconfirmed**                                                 | **Unconfirmed**                                        | **Unconfirmed**                                         | Closed beta                                                       |

## Also found, for 0.1

- **Hot Reload works in a MonoGame game loop on macOS (Observed).** Under `dotnet watch`, method edits reached the running MonoGame DesktopGL game's next frame in 60 to 90 ms, on macOS arm64 with SDK 10.0.103. This answers part of ADR 0004's prototype question for one platform.
- **A sleeping display stops games (Observed).** With the display asleep, raylib could not open a window, and the MonoGame game printed its first log line and then finished no frame; waiting on vsync is the likely cause (**Inference**). Behind a lock screen with the display awake, raylib ignored vsync and drew about 2,700 frames a second. Runs that agents start out of sight, and CI on macOS, need a frame path that does not depend on a visible display.
- **C# replay hazards (Documented).** `System.Numerics.Vector2.Lerp` may fuse, and 23 `Math` methods call the C runtime, so the replay check must cover library helpers as well as arithmetic. Whether MonoGame's own `Vector2` fuses is **Unconfirmed**.

## Open points

- Whether PR #7911 merges and ends the reload crash, and whether Linux and Windows show it; Odin's reload was tested only on macOS.
- How much memory a long reload session on macOS holds, since no library is ever unloaded.
- Whether Livepatch reaches macOS and arm64, how fast it applies a change to a 100,000-line game, and how it fares once released Odin includes its compiler fixes.
- Odin's maths on real x64 hardware with glibc and Microsoft's C runtime; the cross-architecture checks used Rosetta and Apple's x64 maths library.
- Whether Odin gets a `windows_arm64` target, and whether its x64 compiler and games run on Windows on Arm.
- How far the generated code understates compile times. A real game with parametric procedures, many packages and larger libraries, in Odin and in C#, would show it.
- How often everyday game edits are rude edits for C#'s Hot Reload, and whether the first edit of a session stays near one second.
- What Odin 1.0 fixes in January 2027, and its release schedule after that.
- Box2D 3.2's snapshot interface, and whether `vendor:box3d` gets rebuilt with `-ffp-contract=off`.

[ticket]: https://github.com/softhatgames/playstead/issues/103
[ticket-84]: https://github.com/softhatgames/playstead/issues/84
[adr-0004]: ../adr/0004-code-first-games-starting-with-csharp.md
[dotnet-note]: https://github.com/softhatgames/playstead/blob/c6e61bc25b6744d696b0d2e77bd1225710c836d5/docs/research/dotnet-library-delivery.md
[odin-release]: https://github.com/odin-lang/Odin/releases/tag/dev-2026-10
[odin-releases]: https://github.com/odin-lang/Odin/releases
[odin-main-pipeline]: https://github.com/odin-lang/Odin/blob/dev-2026-10/src/main.cpp#L4506-L4647
[odin-separate-modules]: https://github.com/odin-lang/Odin/blob/dev-2026-10/src/build_settings.cpp#L2083-L2103
[odin-disc-5409]: https://github.com/odin-lang/Odin/discussions/5409
[odin-pr-6483]: https://github.com/odin-lang/Odin/pull/6483
[odin-pr-7911]: https://github.com/odin-lang/Odin/pull/7911
[odin-tl-cleaners]: https://github.com/odin-lang/Odin/blob/dev-2026-10/base/runtime/thread_management.odin
[odin-os-cleaner]: https://github.com/odin-lang/Odin/blob/dev-2026-10/core/os/allocators.odin#L73
[livepatch-forum]: https://forum.odin-lang.org/t/livepatch-hot-reload-without-dlls-for-windows/2437
[livepatch-readme]: https://github.com/MatzeOGH/odin_livepatch/blob/2ec23cd34083039128e6e6da5a8a41d5ecb1d2ab/README.md
[livepatch-example]: https://github.com/MatzeOGH/odin_livepatch/blob/2ec23cd34083039128e6e6da5a8a41d5ecb1d2ab/examples/README.md
[livepatch-macos]: https://github.com/MatzeOGH/odin_livepatch/tree/90aa7a3432142342e577ac3f00a2c9522cb983c9
[odin-pr-7845]: https://github.com/odin-lang/Odin/pull/7845
[odin-dynlib]: https://github.com/odin-lang/Odin/blob/dev-2026-10/core/dynlib/lib.odin#L110-L187
[zylinski-template]: https://github.com/karl-zylinski/odin-raylib-hot-reload-game-template/blob/901bb85274b76272fce317a5b7b136d592b77ea6/source/main_hot_reload/main_hot_reload.odin
[apple-dlclose]: https://github.com/apple-oss-distributions/dyld/blob/dyld-1378/doc/man/man3/dlclose.3
[ms-dll-practices]: https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-best-practices
[roslyn-enc]: https://github.com/dotnet/roslyn/blob/3645b6aa36ad41775a73e57a620787a3d38327a0/docs/wiki/EnC-Supported-Edits.md
[odin-raw-types]: https://github.com/odin-lang/Odin/blob/dev-2026-10/base/runtime/core.odin#L508-L561
[odin-overview-copy]: https://github.com/odin-lang/odin-lang.org/blob/20bb95d73c1a63d7107c10b69c0655662cae7115/content/docs/overview.md#L833
[odin-handle-map]: https://github.com/odin-lang/Odin/blob/dev-2026-10/core/container/handle_map/static_handle_map.odin
[odin-map-seed]: https://github.com/odin-lang/Odin/blob/dev-2026-10/base/runtime/dynamic_map_internal.odin#L208-L221
[odin-cbor]: https://github.com/odin-lang/Odin/blob/dev-2026-10/core/encoding/cbor/doc.odin
[odin-relative-removed]: https://github.com/odin-lang/Odin/commit/e38a08013e1afa1bbd7b8f90ee16cfbdfacfb13f
[odin-overview-fusion]: https://github.com/odin-lang/odin-lang.org/blob/20bb95d73c1a63d7107c10b69c0655662cae7115/content/docs/overview.md#L1612
[odin-pr-7068]: https://github.com/odin-lang/Odin/pull/7068
[odin-math-basic]: https://github.com/odin-lang/Odin/blob/dev-2026-10/core/math/math_basic.odin#L6-L42
[odin-dev-2025-12]: https://github.com/odin-lang/Odin/releases/tag/dev-2025-12
[odin-overview-overflow]: https://github.com/odin-lang/odin-lang.org/blob/20bb95d73c1a63d7107c10b69c0655662cae7115/content/docs/overview.md#L1597-L1601
[odin-issue-7248]: https://github.com/odin-lang/Odin/issues/7248
[dotnet-vector2-lerp]: https://github.com/dotnet/runtime/blob/v10.0.3/src/libraries/System.Private.CoreLib/src/System/Numerics/Vector2.cs#L635-L643
[dotnet-math-sin]: https://learn.microsoft.com/en-us/dotnet/api/system.math.sin?view=net-10.0
[rust-rfc-3514]: https://rust-lang.github.io/rfcs/3514-float-semantics.html
[rust-f64-sin]: https://doc.rust-lang.org/std/primitive.f64.html#method.sin
[rust-releases]: https://github.com/rust-lang/rust/blob/1.99.1/RELEASES.md
[odin-dev-2026-01]: https://github.com/odin-lang/Odin/releases/tag/dev-2026-01
[box2d-simulation]: https://box2d.org/documentation/md_simulation.html
[box2d-faq]: https://box2d.org/documentation/md_faq.html
[box2d-replay]: https://box2d.org/posts/2026/06/replay/
[odin-box2d]: https://github.com/odin-lang/Odin/blob/dev-2026-10/vendor/box2d/box2d.odin#L9-L35
[odin-ggpo]: https://github.com/odin-lang/Odin/blob/dev-2026-10/vendor/ggpo/ggpo.odin
[odin-net]: https://github.com/odin-lang/Odin/blob/dev-2026-10/core/net/doc.odin
[raylib-readback]: https://github.com/raysan5/raylib/blob/6.0/src/rtextures.c#L553-L581
[sdl-gpu-download]: https://github.com/libsdl-org/SDL/blob/release-3.4.2/include/SDL3/SDL_gpu.h#L96-L103
[raylib-automation]: https://github.com/raysan5/raylib/blob/6.0/src/rcore.c#L3725-L3799
[sdl-push-event]: https://github.com/libsdl-org/SDL/blob/release-3.4.2/include/SDL3/SDL_events.h#L1360-L1392
[odin-no-rtti]: https://github.com/odin-lang/Odin/blob/dev-2026-10/src/build_settings.cpp#L1871-L1879
[odin-reflect]: https://github.com/odin-lang/Odin/blob/dev-2026-10/core/reflect/reflect.odin
[odin-os-stat]: https://github.com/odin-lang/Odin/blob/dev-2026-10/core/os/stat.odin#L90-L115
[odin-build-tags]: https://github.com/odin-lang/Odin/blob/dev-2026-10/src/parser.cpp#L7072-L7183
[odin-testing]: https://odin-lang.org/docs/testing/
[ols]: https://github.com/DanielGavin/ols/blob/81f34af8a35611e9f0e83484f5f51a8767099030/README.md
[odin-news-2026-09]: https://github.com/odin-lang/odin-lang.org/blob/20bb95d73c1a63d7107c10b69c0655662cae7115/content/news/2026-09.md#L22-L28
[odin-build-bat]: https://github.com/odin-lang/Odin/blob/dev-2026-10/build.bat#L12-L19
[odin-install]: https://odin-lang.org/docs/install/
[odin-issue-6686]: https://github.com/odin-lang/Odin/issues/6686
[odin-cross-link]: https://github.com/odin-lang/Odin/blob/dev-2026-10/src/linker.cpp#L226-L236
[odin-raylib-link]: https://github.com/odin-lang/Odin/blob/dev-2026-10/vendor/raylib/raylib.odin#L99-L146
[odin-crt]: https://github.com/odin-lang/Odin/blob/dev-2026-10/src/linker.cpp#L435-L441
[odin-sdl3-link]: https://github.com/odin-lang/Odin/blob/dev-2026-10/vendor/sdl3/sdl3__foreign.odin
[odin-issue-4966]: https://github.com/odin-lang/Odin/issues/4966
[odin-dev-2025-04]: https://github.com/odin-lang/Odin/releases/tag/dev-2025-04
[odin-dev-2025-08]: https://github.com/odin-lang/Odin/releases/tag/dev-2025-08
[odin-wasm]: https://github.com/odin-lang/Odin/blob/dev-2026-10/vendor/wasm/README.md
[odin-pr-4647]: https://github.com/odin-lang/Odin/pull/4647
[odin-pr-7320]: https://github.com/odin-lang/Odin/pull/7320
[odin-dev-2026-07]: https://github.com/odin-lang/Odin/releases/tag/dev-2026-07
[odin-vendor]: https://github.com/odin-lang/Odin/tree/dev-2026-10/vendor
[sokol-odin]: https://github.com/floooh/sokol-odin
[odin-news-core-os]: https://github.com/odin-lang/odin-lang.org/blob/20bb95d73c1a63d7107c10b69c0655662cae7115/content/news/move-towards-a-new-core-os.md
[odin-forum-slop]: https://forum.odin-lang.org/t/1504/9
[odin-faq-roadmap]: https://github.com/odin-lang/odin-lang.org/blob/20bb95d73c1a63d7107c10b69c0655662cae7115/content/docs/faq.md#L704-L708
[odin-video]: https://www.youtube.com/watch?v=dLPAqXi9In0
[odin-forum-2027]: https://forum.odin-lang.org/t/2167/4
[odin-license]: https://github.com/odin-lang/Odin/blob/dev-2026-10/LICENSE
[odin-vendor-readme]: https://github.com/odin-lang/Odin/blob/dev-2026-10/vendor/README.md
[odin-proposal]: https://github.com/odin-lang/Odin/blob/dev-2026-10/PROPOSAL-PROCESS.md
[jangafx]: https://jangafx.com/
[odin-games]: https://github.com/odin-lang/odin-lang.org/tree/20bb95d73c1a63d7107c10b69c0655662cae7115/content/games
[zig-0151]: https://ziglang.org/download/0.15.1/release-notes.html
[zig-licence]: https://codeberg.org/ziglang/zig/src/tag/0.17.0/LICENSE
[zig-finances]: https://ziglang.org/news/2025-financials/
[zig-0160]: https://ziglang.org/download/0.16.0/release-notes.html
[zig-0170]: https://ziglang.org/download/0.17.0/release-notes.html
[zig-incremental]: https://mlugg.co.uk/posts/incremental-compilation-internals/
[zig-hcs]: https://github.com/ziglang/zig/issues/68
[zig-floatmode]: https://ziglang.org/documentation/0.17.0/#setFloatMode
[zig-readme]: https://codeberg.org/ziglang/zig/src/tag/0.17.0/README.md
[raylib-62]: https://github.com/raysan5/raylib/releases/tag/6.2
[sdl-releases]: https://github.com/libsdl-org/SDL/releases/tag/release-3.4.18
[sdl-platforms]: https://github.com/libsdl-org/SDL/blob/release-3.4.18/docs/README-platforms.md
[tinycc]: https://repo.or.cz/tinycc.git/blob/e23dabed154a8495f3ac1ff3cc9d04fa1c207893:/README
[clang-fp-contract]: https://releases.llvm.org/23.1.0/tools/clang/docs/UsersManual.html
[msvc-fp]: https://learn.microsoft.com/en-us/cpp/build/reference/fp-specify-floating-point-behavior?view=msvc-170
[msvc-crt-math]: https://learn.microsoft.com/en-us/cpp/porting/floating-point-migration-issues?view=msvc-170
[sdl-sin]: https://github.com/libsdl-org/SDL/blob/release-3.4.18/include/SDL3/SDL_stdinc.h
[go-cache]: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
[go-faq]: https://go.dev/doc/faq#creating_a_new_language
[go-plugin]: https://pkg.go.dev/plugin
[go-spec-fma]: https://go.dev/ref/spec#Floating_point_operators
[go-math-const]: https://github.com/golang/go/blob/go1.27.2/src/math/const.go#L5-L7
[ebitengine-readme]: https://github.com/hajimehoshi/ebiten/blob/v2.10.5/README.md
[ebitengine-210]: https://ebitengine.org/en/documents/2.10.html
[ebitengine-switch]: https://ebitengine.org/en/blog/nintendo_switch.html
[jai-beta]: https://x.com/Jonathan_Blow/status/1655799318916530178
[jai-engine]: https://www.gamespress.com/THE-GAME-AWARDS-2025-REVEALS-ORDER-OF-THE-SINKING-STAR-FROM-ARC-GAMES-
[jai-game]: https://store.steampowered.com/app/499170/Order_of_the_Sinking_Star/
