# Game stacks

- **Question:** Which language and libraries should be the default stack for code-first games made with Playstead? Games need a fast edit-to-see cycle, native desktop builds and, for some games, iPhone and Android; consoles are welcome. At the start of the investigation every game was also expected to build to WebAssembly for the preview. That requirement was later dropped: a native game sends its frames to the preview ([ADR 0002](../adr/0002-the-development-layer.md)).
- **Date:** 2026-10-15. All sources were accessed on this date.
- **Outcome:** [ADR 0004](../adr/0004-code-first-games-starting-with-csharp.md) chose C# on .NET 10, the long-term support release, with MonoGame as the first library to try.
- **Local evidence:** two small timing runs on a macOS (Apple silicon) development computer, in a throwaway folder that was then deleted. They are marked **Observed**.

Labels: **Documented** (official documentation, repositories or release notes), **Observed** (the local runs), **Inference** (reasoning, not a source) and **Unconfirmed** (not established).

## C# and .NET

- **Releases (Documented).** .NET 10 is the current long-term support release (2025-11-11; 10.0.13 on 2026-10-13). .NET 11 is at release candidate 2 (2026-10-13), ships in November with shorter support ([dotnet/core releases][dotnet-releases]).
- **Browser (Documented).** By default .NET runs in the browser on the Mono interpreter with partial JIT compilation. Ahead-of-time compilation needs the `wasm-tools` workload, runs only on publish, "usually takes several minutes on small projects" and roughly doubles the download ([build tools and AOT][blazor-aot]). .NET 11 adds CoreCLR for WebAssembly as an opt-in ([.NET 11 previews][dotnet11]). NativeAOT-LLVM for WebAssembly is still experimental ([runtimelab][nativeaot-llvm]). Threads are experimental ([threads][wasm-threads]).
- **Browser size and speed (Observed).** An empty `blazorwasm` app on .NET SDK 10.0.103 rebuilt in about 1 s after an edit, published in Release in 8 s and downloaded about 2.3 MB compressed.
- **Hot Reload (Documented).** `dotnet watch` applies changed method bodies and new types, methods, fields, properties and lambdas; adding `await` or `yield` and renaming parameters need a restart ([Hot Reload][hot-reload]). It works for apps started through `dotnet run` ([dotnet watch][dotnet-watch]), not for ahead-of-time builds, and from .NET 10 for plain browser apps. .NET 11 extends it to iPhone and Android devices ([.NET 11 previews][dotnet11]).
- **Hot Reload in a game loop (Inference, unconfirmed).** A game loop should pick up changed method bodies on the next frame. Whether this holds with MonoGame's native libraries loaded is the technical prototype's question.
- **MonoGame (Documented).** 3.8.6 (2026-10-07) supports desktop, iPhone, Android, Xbox, PlayStation 4 and 5, and Switch and Switch 2, the consoles for registered developers ([platforms][monogame-platforms]). It has no web target yet; an official WebGL2 platform is in progress for 3.8.7 ([#9515][monogame-web], [PR #9559][monogame-web-pr]).
- **Other C# libraries (Documented).**
  - KNI 4.3 reaches the web through Blazor and WebGL, iPhone and Android; its community is small ([KNI][kni]).
  - FNA documents Xbox, Switch and PlayStation 5, all built with NativeAOT, and iPhone through the .NET SDK. Its web builds come from community templates ([FNA appendix][fna]).
  - Raylib-cs 8.1 added a browser target but has no iPhone or Android support and is "passively maintained" ([Raylib-cs][raylib-cs]).
- **Phones (Documented).** iPhone forbids JIT compilation. On .NET 10, iPhone apps use Mono ahead-of-time compilation, with an interpreter in Debug; .NET 11 moves to CoreCLR with precompiled code and an interpreter ([interpreter][maui-interpreter]).

## Rust

- **Libraries (Documented).** winit and wgpu support the web, iPhone and Android; wgpu runs on WebGPU or WebGL2 ([wgpu][wgpu]). macroquad 0.4 supports the web through WebGL1 without wasm-bindgen, plus iPhone and Android ([macroquad][macroquad]). Bevy 0.20 (2026-10-08) uses WebGL2 on the web, where WebGPU is experimental and audio may stutter; its own table gives 4.8–13 MB of WebAssembly for a small 3D scene ([Bevy examples][bevy-examples]). Bevy calls its compile times "rather long" ([setup][bevy-setup]).
- **Speed (Observed).** A macroquad "hello world" with rustc 1.98.1 built for WebAssembly from clean in 2.0 s and rebuilt after an edit in 0.2 s, for WebAssembly and natively. The Release WebAssembly file was 600 KB, 182 KB compressed. Bevy was not measured.
- **Hot patching (Documented).** Dioxus's `subsecond` works on WebAssembly, desktop, Android and the iPhone simulator, but not iPhone devices. It needs explicit call points and cannot change struct layouts ([Dioxus 0.7][subsecond]). Bevy's hot patching covers systems only and is "Not supported in Wasm" ([Bevy 0.17][bevy-017]).
- **Consoles (Unconfirmed).** No public console backend was found for these crates.
- **Tooling (Documented).** The rustwasm organisation was sunset on 2025-07-21; wasm-bindgen moved to its own organisation ([announcement][rustwasm]).

## Other languages

- **TypeScript (Documented).** Native to the web; desktop through Electron or Tauri, and phones through Tauri 2 or Capacitor ([Tauri 2][tauri]). No first-party console route was found.
- **C and C++ (Documented).** raylib 6.0 lists desktop, Android and HTML5 ([raylib][raylib]). SDL 3 documents Emscripten, iPhone and Android ([SDL Emscripten][sdl-emscripten]); console ports exist for licensed developers.
- **Haxe with Heaps (Documented)** lists HTML5, Android, iPhone, Switch, PlayStation 4 and Xbox; it is niche ([Heaps][heaps]).

## iPhone constraints

- **No JIT (Documented).** Apple disallows running generated code on the device, so .NET precompiles or interprets ([interpreter][maui-interpreter]).
- **Downloaded code (Documented).** App Review guideline 2.5.2 forbids downloading code that changes an app's features; guideline 4.7 allows HTML5 mini-games with extra rules ([guidelines][app-review]).
- **Inference.** Bundling the game is fine; pushing new game code after review is not.

## REDox

- **What it is (Documented).** REDox is Capcom's structured-data library for .NET, Apache-2.0. It parses JSON, JSON5, CBOR and MessagePack into a compact token document that can be edited in place. TOML, XML, HTML and CSV are preview packages ([README][redox]).
- **Maturity (Documented).** The repository was created on 2026-09-30; v1.0.0 was released on 2026-10-01 and v1.0.1 on 2026-10-06. It targets `net10.0` only. The core project declares `IsAotCompatible`.
- **Relevance (Inference).** Its comment-preserving JSON5 editing lets a tool save tuning values without losing the person's comments, and one set of converters can read readable JSON5 in development and compact MessagePack in release. Its speed claims, 1.4–1.8× faster deserialisation than `System.Text.Json` on its own benchmarks, matter little for small games.
- **Unconfirmed.** Behaviour under ahead-of-time compilation on iPhone and consoles. Agents have no training data for it, so skills would need to document its interface.

## Comparison

| Stack               | Web build                        | Edit to see                      | Desktop | Phones  | Consoles            |
| ------------------- | -------------------------------- | -------------------------------- | ------- | ------- | ------------------- |
| C# with MonoGame    | Not yet; official WebGL2 planned | Hot Reload on desktop            | Strong  | Strong  | Ships on all three  |
| Rust with macroquad | Mature, small                    | 0.2 s rebuild, then restart      | Good    | Yes     | None public         |
| Rust with Bevy      | Large; WebGPU experimental       | Slower; hot patching native-only | Strong  | Yes     | None public         |
| TypeScript          | Native                           | Fastest                          | Wrapper | Wrapper | None found          |
| C or C++ with SDL 3 | Mature (Emscripten)              | Rebuild and restart              | Strong  | Yes     | Ports under licence |

## Open points

- Whether Hot Reload takes effect inside a running MonoGame game, and how long a change takes to appear.
- The delay of frames sent from a MonoGame game into the Electron preview.
- Whether a game gets a GPU context, audio and input under Codex's sandbox on macOS and Windows.
- Whether .NET's maths functions give the same results on x64 and ARM64, and which physics library allows snapshots and replays the same across machines ([ADR 0003](../adr/0003-game-state-in-the-games-playstead-builds.md)).
- REDox under ahead-of-time compilation.
- Rust on consoles under non-disclosure agreements.

[dotnet-releases]: https://github.com/dotnet/core/tree/main/release-notes
[blazor-aot]: https://learn.microsoft.com/aspnet/core/blazor/webassembly-build-tools-and-aot
[dotnet11]: https://github.com/dotnet/core/tree/main/release-notes/11.0/preview
[nativeaot-llvm]: https://github.com/dotnet/runtimelab/tree/feature/NativeAOT-LLVM/docs/using-nativeaot
[wasm-threads]: https://github.com/dotnet/runtime/blob/main/src/mono/wasm/threads.md
[hot-reload]: https://learn.microsoft.com/aspnet/core/test/hot-reload
[dotnet-watch]: https://learn.microsoft.com/dotnet/core/tools/dotnet-watch
[monogame-platforms]: https://docs.monogame.net/articles/getting_started/platforms.html
[monogame-web]: https://github.com/MonoGame/MonoGame/issues/9515
[monogame-web-pr]: https://github.com/MonoGame/MonoGame/pull/9559
[kni]: https://github.com/kniEngine/kni
[fna]: https://fna-xna.github.io/docs/appendix/
[raylib-cs]: https://github.com/raylib-cs/raylib-cs
[maui-interpreter]: https://learn.microsoft.com/dotnet/maui/macios/interpreter
[wgpu]: https://github.com/gfx-rs/wgpu
[macroquad]: https://github.com/not-fl3/macroquad
[bevy-examples]: https://github.com/bevyengine/bevy/blob/v0.20.0/examples/README.md
[bevy-setup]: https://bevy.org/learn/quick-start/getting-started/setup/
[subsecond]: https://github.com/DioxusLabs/dioxus/releases/tag/v0.7.0
[bevy-017]: https://bevy.org/news/bevy-0-17/
[rustwasm]: https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org/
[tauri]: https://v2.tauri.app/blog/tauri-20/
[raylib]: https://github.com/raysan5/raylib
[sdl-emscripten]: https://github.com/libsdl-org/SDL/blob/main/docs/README-emscripten.md
[heaps]: https://heaps.io
[app-review]: https://developer.apple.com/app-store/review/guidelines/
[redox]: https://github.com/CAPCOM-TD-OSS/REDox
