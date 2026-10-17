# Exporting a MonoGame DesktopGL game for six desktop platforms

- **Question:** What does it take to turn a MonoGame DesktopGL game into a standalone build that runs, without .NET installed, on macOS arm64 and x64, Windows x64 and arm64, and Linux x64 and arm64? Asked in [#84][ticket]; the findings feed **Exporting standalone builds** (#97) and **The CI game checks** (#99).
- **Date:** 2026-10-17. All sources were accessed on this date.
- **Outcome:** All six platforms are reachable with MonoGame DesktopGL 3.8.6. Its SDL and OpenAL packages ship native libraries for `win-x64`, `win-arm64`, `linux-x64`, `linux-arm64` and a universal `osx` build, so nothing is missing for `win-arm64` or `linux-arm64`. The weak spot is `win-arm64`: MonoGame does not test it, and OpenGL on Windows on Arm is unconfirmed. One Mac published all six as self-contained builds of 35–38 MB compressed, and the macOS builds ran on both architectures. Only NativeAOT needs the target's own operating system. A macOS export must be a bundle signed ad hoc as a whole, with `codesign` on a Mac or `rcodesign` elsewhere. Gatekeeper and SmartScreen then let the person override their warnings; Smart App Control blocks an unsigned game outright. A recommendation; the founder decides: self-contained, untrimmed builds compiled at run time, as a zip for Windows, a `.tar.gz` for Linux, and one universal ad-hoc-signed `.app` built from single-file publishes for macOS.
- **Versions:**
  - MonoGame.Framework.DesktopGL 3.8.6, released 2026-10-07 from commit `c610a52`, built for `net8.0` ([release][mg-release], [package][mg-nuget]). It depends on MonoGame.Library.SDL 2.32.10.2 (SDL 2.32.10), MonoGame.Library.OpenAL 1.24.3.4 (OpenAL Soft 1.24.3) and NVorbis 0.10.4. Newer native packages, SDL 2.32.10.3 and OpenAL 1.25.2.2, carry the same runtime identifiers; a 3.8.6 game gets the versions above unless it asks for newer ones.
  - MonoGame.Templates.CSharp and MonoGame.Content.Builder.Task 3.8.6 ([template][mg-template], [content task][mg-cb-task]).
  - .NET SDK 10.0.103 with runtime 10.0.3. The current patch is 10.0.13.
  - apple-codesign (`rcodesign`) 0.29.0 of 2024-11-29, its latest release ([release][rcodesign-release]). Read, not run.
- **Local evidence:** a minimal DesktopGL project, written for this note in a scratch folder under `/tmp`, outside the repository. It reads a content file through MonoGame, creates a silent sound to load OpenAL and reports the time from process start to the first drawn frame. It was published for all six runtime identifiers on an Apple silicon Mac (M3 Max, macOS 26.6.2, Xcode Command Line Tools). The macOS builds ran natively and under Rosetta; the Windows and Linux builds were built and inspected, not run. Packages and release archives were downloaded into folders of their own and only read. These results are marked **Observed**.

Labels: **Documented** (official documentation, repositories, packages or release notes), **Observed** (the local runs and inspections), **Inference** (reasoning, not a source) and **Unconfirmed** (not established).

## Native libraries

- **What DesktopGL uses (Documented).** DesktopGL "uses SDL for windowing, **OpenGL** for graphics, and OpenAL-Soft for audio" ([platforms][mg-platforms]). NVorbis, the third dependency, is managed code only (**Observed**).
- **What the packages ship (Observed).** Both native packages carry `runtimes/<rid>/native` for five identifiers. The `osx` libraries are universal, x86_64 and arm64; `osx` is the identifier .NET keeps "for universal binaries supporting both x64 and arm64" ([RID catalogue][rid]). OpenAL also ships iOS and Android builds.

  | Package                          | Windows                        | Linux                                     | macOS                            |
  | -------------------------------- | ------------------------------ | ----------------------------------------- | -------------------------------- |
  | MonoGame.Library.SDL 2.32.10.2   | `SDL2.dll` for x64 and ARM64   | `libSDL2-2.0.so.0` for x86-64 and aarch64 | `libSDL2-2.0.0.dylib`, universal |
  | MonoGame.Library.OpenAL 1.24.3.4 | `openal.dll` for x64 and ARM64 | `libopenal.so` for x86-64 and aarch64     | `libopenal.dylib`, universal     |

- **Who builds them (Documented).** MonoGame builds both libraries itself on GitHub Actions. Windows x64 and ARM64 come from `windows-latest` through CMake with `-A ARM64` and the static MSVC runtime; Linux builds natively on `ubuntu-22.04` and `ubuntu-22.04-arm`; SDL's macOS build is universal with a 10.15 deployment target ([SDL workflow][sdl-lib-ci], [SDL Windows][sdl-lib-win], [SDL macOS][sdl-lib-mac], [OpenAL workflow][openal-lib-ci], [OpenAL Windows][openal-lib-win]).
- **Upstream (Documented).** Neither upstream release has Windows Arm binaries. SDL 2.32.10 ships Windows x86 and x64 binaries and a macOS image, although its CI builds MSVC ARM64 ([release][sdl-release], [CI plan][sdl-ci]). OpenAL Soft 1.24.3 ships Win32 and Win64 only, and its CI has no Windows Arm or Linux arm64 job ([release][openal-release], [CI][openal-ci]).
- **What they need from the system (Observed).**
  - Windows: the DLLs import only Windows system DLLs, so no Visual C++ runtime is needed. They carry no Authenticode signature.
  - macOS: the dylibs link only system frameworks, carry the linker's ad-hoc signature and record macOS 11.0 (arm64) and 10.15 (x64) as their minimum.
  - Linux: both libraries need glibc 2.34 symbols. OpenAL also needs `GLIBCXX_3.4.29`, the libstdc++ of GCC 11.1 ([GCC ABI][gcc-abi]). SDL links only libc and libm, and OpenAL adds the C++ runtime. SDL's binary names the X11, Wayland, EGL, OpenGL, ALSA, PulseAudio, JACK, sndio, udev and D-Bus libraries it opens at run time, and OpenAL Soft's names PipeWire, PulseAudio, ALSA, JACK and PortAudio.
- **How MonoGame finds them (Documented).** SDL goes through MonoGame's own loader, which tries the app's base folder, then `../Frameworks` on macOS, then `runtimes/<rid>/native`, then the system ([loader][mg-funcloader]). OpenAL goes through .NET's ordinary `DllImport("openal")` probing ([OpenAL bindings][mg-openal]). Publishing for a runtime identifier puts both beside the executable, where both are found (**Observed**).
- **Testing on arm64 (Documented).** MonoGame 3.8.6's CI runs the DesktopGL tests on `ubuntu-24.04-arm` under `xvfb-run`, without audio, and on its own Windows and macOS machines; no job runs on Windows on Arm ([CI][mg-ci]). In [issue #9047][mg-9047], DesktopGL 3.8.4 crashed on Windows 11 on Arm. A maintainer pointed to SDL 2.32.10.2 and OpenAL 1.24.3.4 for the Windows Arm binaries and wrote "I don't have a windows arm machine to test on"; on 2026-07-19 the reporter called it resolved with 3.8.5.
- **OpenGL on Windows on Arm (Documented, Unconfirmed).** DesktopGL "requires at least OpenGL 2.0 with the ARB_framebuffer_object extension (or alternatively at least OpenGL 3.0)" ([platforms][mg-platforms]). It asks SDL for an OpenGL 2.1 context and otherwise stops with "MonoGame requires OpenGL 3.0 compatible drivers" ([device manager][mg-gdm], [context][mg-glcontext]). Microsoft's OpenCL and OpenGL Compatibility Pack maps OpenGL up to 3.3 onto Direct3D 12 "in environments where native drivers are not available, such as on Windows on ARM", and comes from the Microsoft Store ([announcement][gl-pack]). Whether current Arm laptops ship a native OpenGL driver, or the pack, is unconfirmed.

## Publishing

- **Self-contained (Documented).** A self-contained publish includes the .NET runtime, so the receiving computer needs no .NET, but it "doesn't include the native dependencies of .NET", which must already be there ([publishing][dotnet-publish]). MonoGame recommends it with `-p:PublishReadyToRun=false -p:TieredCompilation=false` ([packaging][mg-packaging]), and its DesktopGL template sets both to `false` ([template][mg-template]).
- **Runtime patch (Documented, Observed).** A self-contained publish "selects the latest version installed as part of the SDK on the publishing machine", and "the application must be republished to obtain a new patch" ([patch selection][patch-selection]). The probe carried .NET 10.0.3 from SDK 10.0.103, although 10.0.13 is current.
- **Size and start-up (Observed).** All on the Mac, for `osx-arm64` unless named. The first frame is measured from process start to the end of the first `Draw`, as the median of five runs; it includes creating the window, the OpenGL context and OpenAL.

  | Build                                   | On disk                                     | Compressed                 | First frame                   |
  | --------------------------------------- | ------------------------------------------- | -------------------------- | ----------------------------- |
  | Self-contained folder, MonoGame's flags | 90 MB, 196 files (all six: 82–91 MB)        | 35 MB (all six: 35–38 MB)  | 0.42 s                        |
  | Tiered compilation on, the .NET default | 90 MB                                       | not measured               | 0.39 s                        |
  | ReadyToRun                              | 92 MB                                       | 36 MB                      | 0.40 s                        |
  | Trimmed                                 | 27 MB, 44 files (three platforms: 24–28 MB) | 11–12 MB (three platforms) | 0.49 s                        |
  | Single-file                             | 81 MB executable and 6 MB of libraries      | 33 MB                      | 0.42 s                        |
  | NativeAOT, debug symbols kept apart     | 3.7 MB executable and 6 MB of libraries     | 4 MB                       | 0.36 s                        |
  | `osx-x64` folder under Rosetta          | 84 MB                                       | 37 MB                      | 0.69 s; 5.9 s at first launch |

  NativeAOT still needs 0.36 s to its first frame, so most of the start-up is MonoGame creating the window and context, not .NET (**Inference**).
- **Single-file (Documented, Observed).** Only managed assemblies go into the file, and they are "loaded in memory, avoiding the extraction to a folder". Native libraries stay beside it unless `IncludeNativeLibrariesForSelfExtract` is set, which extracts them under `$HOME/.net` or `%TEMP%/.net` ([single-file][single-file]). MonoGame advises against single-file as "a hidden self-extracting zip archive" ([packaging][mg-packaging]); that describes the extraction modes, not the default (**Inference**). The probe started as fast as the folder build. With `IncludeNativeLibrariesForSelfExtract` it crashed at start with "Failed to load library: libSDL2-2.0.0.dylib", because MonoGame's loader does not look in the extraction folder (**Observed**).
- **Trimming (Documented, Observed).** Trimming is "only available to applications that are published self-contained" and can fail at run time on code it cannot analyse, mostly reflection ([trimming][trimming]). MonoGame calls itself "mostly compatible" and warns about custom content readers with generic collections and about `XmlSerializer` ([packaging][mg-packaging]). The probe trimmed without a single warning, to a third of the size, and started 70 ms later (**Observed**); the trimmed framework assemblies lose their precompiled code (**Inference**).
- **ReadyToRun (Documented, Observed).** ReadyToRun stores precompiled code beside the IL, and assemblies grow "between two to three times larger" ([ReadyToRun][r2r]). MonoGame recommends against it "because it produces micro stutters" ([packaging][mg-packaging]). MonoGame.Framework.dll grew from 1.3 MB to 2.7 MB; start-up did not change measurably.
- **NativeAOT (Documented, Observed).** NativeAOT compiles everything ahead of time, implies trimming and a single file, and allows no dynamic loading or run-time code generation ([NativeAOT][aot]). The probe built in about 8 s without warnings and ran. It can only be built on the target's operating system (see the next section).
- **Where content goes (Documented, Observed).** MonoGame's content task runs MGCB on the build machine with `/platform:DesktopGL` and adds the results as `Content` items copied to the output ([content task][mg-cb-task]). Publishing places them in `Content/` beside the executable. MonoGame's `TitleContainer` reads from the executable's folder, and on macOS first from `../Resources`, which is `Contents/Resources` in a bundle ([TitleContainer][mg-titlecontainer]). The probe found its content in both places. One content build serves all six platforms, since the content platform is DesktopGL rather than a runtime identifier (**Inference**).

## Exporting for other platforms

- **From one Mac (Observed).** The Mac published self-contained builds for all six runtime identifiers without warnings, in 5–7 s each once packages were cached. MonoGame documents that DesktopGL can "cross-compile any build from any of these operating systems" ([platforms][mg-platforms]).
- **Windows details from any system (Documented, Observed).** The Mac-built `.exe` files have the Windows GUI subsystem, the icon, a version resource from the project's `Version`, `Company` and `Product`, and the template's `app.manifest`. .NET's host model edits Windows resources on every operating system since a cross-platform resource updater replaced the Windows API in 2023 ([dotnet/runtime#89303][resource-updater], [#103327][resource-updater-os]).
- **macOS signing from any system (Documented).** The .NET 10 SDK signs `osx-*` executables, including single-file bundles, ad hoc on any build system, with a managed signer whose output matches `codesign`'s apart from padding ([SDK targets][sdk-targets], [dotnet/runtime#108992][macho-sign], [HostWriter][hostwriter]). The .NET 9 SDK did so only on a Mac with `/usr/bin/codesign` ([.NET 9 targets][sdk9-targets]).
- **Linux permissions (Documented).** The SDK marks the executable 755 only when the build system is not Windows ([HostWriter][hostwriter]). An export made on Windows has to set the mode in its archive (**Inference**).
- **ReadyToRun (Documented, Observed).** Microsoft's table says a Mac can precompile for Linux and macOS only ([ReadyToRun][r2r]). SDK 10.0.103 on the Mac also precompiled `win-x64`; MonoGame.Framework.dll became a 2.5 MB x64 image.
- **NativeAOT (Documented, Observed).** "Native AOT does not support cross-OS compilation". Between x64 and arm64 on one system it works with the right toolchain: Xcode on a Mac, the Visual Studio ARM64 or x64 C++ build tools on Windows, a cross-linker and target libraries on Linux ([cross-compilation][aot-cross]). On the Mac, `win-x64` stopped with "Cross-OS native compilation is not supported."; `linux-x64` compiled and then failed to link; `osx-x64` built and ran under Rosetta.
- **Universal macOS binaries (Documented, Observed).** ".NET doesn't produce universal binaries directly"; Microsoft merges two single-file or NativeAOT executables with Apple's `lipo` and re-signs the result ([publishing for macOS][dotnet-macos]). `dotnet publish -r osx` fails with NETSDK1084, no application host for `osx`. LLVM's `llvm-lipo` "can create universal binaries" on other systems ([llvm-lipo][llvm-lipo]).
- **Bundle signing off a Mac (Documented).** `rcodesign` is pure Rust, and "Linux, Windows, and macOS are officially supported" ([README][rcodesign-readme]). `rcodesign sign` without a certificate makes an ad-hoc signature and signs nested Mach-O binaries by default ([signing][rcodesign-signing]). Its release has binaries for Linux, Windows and macOS. Not tried here.
- **What needs the target system (Inference).** NativeAOT, AppImage builds (see Linux) and every run of an export. .NET does not support running under the QEMU emulator ([supported OS][supported-os]). GitHub lists hosted runners for all six: `ubuntu-24.04` and `ubuntu-24.04-arm`, `windows-2025` and `windows-11-arm`, `macos-15-intel` and `macos-15` ([runners][gh-runners]).

## macOS

- **The bundle MonoGame documents (Documented).** `YourGame.app/Contents/` holds `Info.plist`, `MacOS/YourGame` and `Resources/`, which holds `Content/` and `YourGame.icns`. The example `Info.plist` sets `CFBundleExecutable`, `CFBundleIconFile`, `CFBundleIdentifier`, `CFBundlePackageType` `APPL`, the games category, `LSMinimumSystemVersion` 10.15, `LSRequiresNativeExecution` and `LSArchitecturePriority` arm64. The icon is made from a 1024-pixel `Icon.png` with `sips` and `iconutil`. The guide publishes `osx-x64` and `osx-arm64`, merges the two executables with `lipo`, and archives as `.tar.gz` "to preserve the execution permissions" ([packaging][mg-packaging]).
- **The guide's gap (Observed).** The guide merges only the executable. A bundle made that way does not start: "The application to execute does not exist: …/Contents/MacOS/Probe.dll". The rest of a folder publish differs by architecture: 173 of 175 managed assemblies differ between `osx-arm64` and `osx-x64`, and the runtime's dylibs are single-architecture. A folder publish can only make one bundle per architecture.
- **Where Apple wants things (Documented).** The main executable goes in `Contents/MacOS`, dynamic libraries in `Contents/Frameworks`, and everything that is not Mach-O code in `Contents/Resources`. "If you put content in the wrong location, you may encounter hard-to-debug code signing and distribution problems" ([placing content][apple-placing]).
- **What breaks (Observed).**
  - A whole folder publish in `Contents/MacOS` runs, but `codesign` cannot seal it: it treats the managed `.dll` files there as unsigned code. `--deep` gets through only by storing signatures for those files in extended attributes, and it replaces Microsoft's Developer ID signatures on the runtime with ad-hoc ones.
  - With SDL and OpenAL in `Contents/Frameworks`, SDL loads but OpenAL does not ("OpenAL device could not be initialized"), since only MonoGame's own loader looks there. A game could add its own `DllImport` resolver (**Inference**).
- **A layout that works (Observed).** `Contents/MacOS/` holds the executable (single-file or NativeAOT, merged with `lipo`), `libSDL2-2.0.0.dylib` and `libopenal.dylib`. `Contents/Resources/` holds `Content/` and the `.icns`. `Contents/Info.plist` sets `LSMinimumSystemVersion` to 15.0. Clear the extended attributes, sign the two dylibs, then sign the bundle:

  ```sh
  xattr -cr Game.app
  codesign --force --sign - Game.app/Contents/MacOS/*.dylib
  codesign --force --sign - Game.app
  ```

  MonoGame's dylibs carry only the linker's signature, which the bundle seal rejects until they are signed again. The result passes `codesign --verify --deep --strict` and runs natively on arm64, under Rosetta as x64, and through `open`. A universal bundle is 155 MB (65 MB zipped) from single-file publishes and 13 MB (5.6 MB zipped) from NativeAOT.
- **Universal or per architecture (Documented, Inference).** A universal bundle is one download that runs natively on both. Apple keeps Rosetta "as a general-purpose tool for Intel apps" through macOS 27, then only "a subset of Rosetta functionality aimed at supporting older unmaintained gaming titles" ([Rosetta][apple-rosetta]), so an x64-only build has a short future on Apple silicon. Separate bundles halve the download but make the person choose.
- **The ad-hoc signature (Documented, Observed).** On Apple silicon "any executable must be signed before it's allowed to run… a simple ad-hoc signature is sufficient"; translated x86 code is exempt ([Big Sur notes][apple-bigsur]). An unsigned arm64 executable therefore cannot run at all, whatever Gatekeeper decides. Every Mach-O file in a publish is already signed: the executable ad hoc by the SDK, MonoGame's dylibs ad hoc by their linker, and, in a folder publish, the runtime's dylibs with Microsoft's Developer ID. The bundle still needs its own signature once assembled. Without it, `spctl` reports "code has no resources but signature indicates they must be present".
- **Archives (Observed).** A zip made with `ditto` kept the signature valid when `ditto` extracted it. Info-ZIP's `unzip` broke the seal, because `ditto` had stored the dylibs' `com.apple.provenance` attribute as `._` files that landed in `Contents/MacOS`. Clearing extended attributes before signing fixed it.
- **Gatekeeper on macOS 15 and later (Documented, Observed).** Gatekeeper expects downloaded software to be signed by an identified developer and notarised, and "requests user approval before opening downloaded software for the first time" ([Gatekeeper][apple-gatekeeper]). Since macOS 15, "users will no longer be able to Control-click to override Gatekeeper"; they review the software in System Settings → Privacy & Security ([Sequoia][apple-sequoia]). The person tries to open the app, then clicks **Open Anyway** there, an option "available for about an hour after you try to open the app", and enters their login password. The app is then saved as an exception ([open an app][apple-open-anyway], [safely open apps][apple-safely-open]). On the Mac, `spctl` rejected the signed universal bundle, and `syspolicy_check` called it ad hoc signed and "not suitable for distribution", with no notarisation ticket.
- **Download, AirDrop, USB stick (Documented, Unconfirmed).** Quarantine is set by "applications which download file content from the Internet", and Launch Services shows an alert when a quarantined application is opened ([Launch Services][apple-quarantine]), so browser downloads meet Gatekeeper. Apple's pages say nothing about AirDrop; a secondary source says AirDrop transfers "can have a quarantine flag attached" ([Eclectic Light][eclectic-quarantine]) — **Unconfirmed**. A game copied from a USB stick that was never downloaded carries no quarantine and should open without a prompt (**Inference**), as the unquarantined bundle did through `open` here (**Observed**). Gatekeeper may open downloaded apps "from randomized, read-only locations" ([Gatekeeper][apple-gatekeeper]), so a game must write its saves outside its bundle (**Inference**).
- **Notarisation (Documented).** Notarisation needs an Apple Developer account, and apps not published as NativeAOT need the `com.apple.security.cs.allow-jit` entitlement ([publishing for macOS][dotnet-macos]). It waits for 1.0, with signed game builds ([roadmap][roadmap]).

## Windows

- **Form (Documented, Observed).** MonoGame zips the self-contained publish folder ([packaging][mg-packaging]). The `win-x64` and `win-arm64` folders are 36–38 MB zipped. 187 of their 193 binaries carry Authenticode signatures; they are the .NET runtime's files. The six unsigned ones are the game's `.exe` and `.dll`, `MonoGame.Framework.dll`, `NVorbis.dll`, `SDL2.dll` and `openal.dll`.
- **Icons and version (Documented, Observed).** `ApplicationIcon` names "the `.ico` icon file to pass to the compiler for embedding as a Win32 icon" ([MSBuild][msbuild-props]); the SDK copies it, the version resource and the manifest into the `.exe` on any system. The window icon comes from an embedded `Icon.bmp` that MonoGame hands to SDL ([window][mg-window]); the template embeds both icon files ([template][mg-template]).
- **x64 and arm64 (Documented).** .NET 10 supports both on Windows 11, and "the x64 and x86 emulators are supported on Windows 11 Arm64" ([supported OS][supported-os]), so a `win-x64` export is a fallback on Arm (**Inference**). The Arm build's risks are those above: no testing at MonoGame, and OpenGL unconfirmed.
- **SmartScreen (Documented).** SmartScreen checks downloaded files against a list of well-known, frequently downloaded files and warns when a file is not on it ([SmartScreen][smartscreen]). "By default, Microsoft Defender SmartScreen allows users to bypass warnings"; an organisation can prevent the bypass by policy ([settings][smartscreen-settings]). It "protects against malicious files from the internet", not files on internal locations or network shares ([SmartScreen][smartscreen]). Microsoft's pages do not name the dialog's buttons; "More info" and then "Run anyway" come from third-party guides (**Unconfirmed**).
- **Smart App Control (Documented).** It blocks "unknown, unsigned code" unless Microsoft's app intelligence predicts the app is safe or it is signed with a certificate from the Trusted Root Program ([Smart App Control][sac]). "There is currently no way to bypass Smart App Control protection for individual apps"; an unsigned app or an invalid signature is blocked; recent updates let it be turned back on without reinstalling Windows ([FAQ][sac-faq]). An unsigned 0.1 export will not run where it is on, and the person's only choice is to turn it off (**Inference**).

## Linux

- **Form (Documented, Observed).** MonoGame archives the publish folder as `.tar.gz` "to preserve the execution permissions" ([packaging][mg-packaging]). The Mac-built executable was 755 and kept that mode in the archive. macOS `tar` also wrote `com.apple.provenance` attributes into the archive as pax headers until run with `--no-xattrs`.
- **AppImage (Documented).** An AppDir needs `AppRun`, exactly one `.desktop` file and an icon ([AppDir][appimage-appdir]). AppImages "require … FUSE", and distributions that install only FUSE 3 needed `libfuse2` added ([FUSE][appimage-fuse]); the current runtime is linked statically, so "libfuse2 is no longer required on the target system" ([type2-runtime][appimage-runtime]). `appimagetool` ships only as Linux AppImages and picks the target's runtime by `ARCH` ([appimagetool][appimagetool]). AppImage's advice is to build on a system no newer than the oldest one targeted and to bundle anything not on every base system ([best practices][appimage-best]). For a game whose only native libraries are SDL and OpenAL, an AppImage adds a single file and a menu entry but needs a Linux machine to build (**Inference**). Flatpak and Snap were not examined; the roadmap leaves store packaging to 1.0.
- **Menu entries (Documented).** Desktop entries describe "how a particular program is to be launched, how it appears in menus", end in `.desktop`, and take their ID from where they sit under `applications/` in `$XDG_DATA_DIRS` ([Desktop Entry][desktop-entry], [file naming][desktop-entry-naming]). An extracted folder has no menu entry until one is installed (**Inference**).
- **What the distribution must provide (Documented, Observed).**
  - .NET 10 needs glibc 2.27 on x64 and arm64 ([supported OS][supported-os]) and lists libgcc, libstdc++, ICU, tzdata, CA certificates, OpenSSL and Kerberos as its packages ([dependencies][dotnet-deps]); a game that never uses TLS or Kerberos should not load the last three (**Inference**). Without ICU "the application will fail to start" unless invariant globalisation is on ([invariant mode][invariant]).
  - MonoGame's libraries need glibc 2.34 and GCC 11's libstdc++ (**Observed**, above).
  - Graphics: SDL 2.32.10 tries X11 before Wayland ([SDL video][sdl-video]), so a Wayland desktop runs the game through XWayland (**Inference**). OpenGL comes from the system's driver.
  - Audio: OpenAL Soft points Linux builds at "PipeWire, PulseAudio, and ALSA" ([README][openal-readme]).
- **Invariant globalisation (Documented, Inference).** `InvariantGlobalization` removes the ICU dependency, and numbers "will always be formatted as the invariant culture" ([invariant mode][invariant]). Games would lose culture-specific formatting and sorting. It is worth weighing for exports.

## Minimums

- **.NET 10 (Documented).** macOS 27, 26 and 15; macOS 14 left support on 2026-09-14. Windows 11 26H1, 25H2 and 24H2, 23H2 only in Enterprise and Education editions (23H2 Home and Pro are listed unsupported), and some Windows 10 LTSC editions. Linux includes Ubuntu 26.04, 24.04 and 22.04, Debian 13, Fedora 44 and 43, RHEL 10, 9 and 8, SUSE 16.0 and 15.7, openSUSE Leap 16.0 and Alpine 3.21–3.24, with glibc 2.27 or musl 1.2.3 as the floor ([supported OS][supported-os], last updated 2026-09-28).
- **Windows servicing (Documented).** Windows 11 23H2 and 24H2 have reached end of updates for Home and Pro; 23H2 Enterprise and Education end on 2026-11-10; 25H2 Home and Pro run to 2027-10-12 ([release information][win11-release]). The roadmap's "Windows 11 23H2" no longer matches .NET 10's support for most players (**Inference**).
- **What an export enforces (Observed, Inference).** Nothing in a Windows export checks the version. On macOS, the .NET 10.0.3 binaries record macOS 12.0 as their minimum and MonoGame's dylibs 11.0 and 10.15, so only `LSMinimumSystemVersion`, "the minimum version of the operating system required for the app to run in macOS" ([LSMinimumSystemVersion][apple-lsmin]), can make macOS 15 the floor. On Linux the dynamic loader refuses libraries that need a newer glibc.
- **Linux in practice (Documented, Observed).** MonoGame's libraries raise the floor from glibc 2.27 to 2.34. RHEL 8 ships glibc 2.28 ([Red Hat][rhel8-glibc]) and Alpine uses musl, which MonoGame's packages do not cover: both are supported by .NET 10 but cannot run a DesktopGL export as packaged. Ubuntu 22.04 has 2.35 ([Ubuntu][ubuntu-libc]), RHEL 9 has 2.34 ([Red Hat][rhel9-glibc]) and SUSE 15 SP7 has 2.38 ([SUSE][sles-glibc]).
- **MonoGame (Documented).** DesktopGL supports Windows 8.1 and later, macOS 10.15 and later, and 64-bit Linux ([platforms][mg-platforms]). Its floors sit below .NET 10's, except on Linux.

## The six platforms

| Platform      | Native libraries at 3.8.6                                                   | How a build is made, and from which host                                                                                 | Form                          | Signing                                                                                                   | What the receiving computer does                                                                                                       |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64   | Universal `libSDL2-2.0.0.dylib` and `libopenal.dylib`, linker-signed ad hoc | `osx-arm64` single-file publish on any system, or NativeAOT on a Mac; merged with the x64 slice by `lipo` or `llvm-lipo` | One universal `.app` in a zip | Ad hoc: the SDK signs the executable; dylibs and bundle with `codesign` on a Mac or `rcodesign` elsewhere | Downloaded: blocked until **Open Anyway** in Privacy & Security and the login password. Not quarantined: opens (inferred)              |
| macOS x64     | The same universal libraries                                                | `osx-x64` single-file publish on any system, or NativeAOT on a Mac                                                       | The same `.app`               | As arm64                                                                                                  | As arm64 on Intel Macs; Apple silicon runs the arm64 slice                                                                             |
| Windows x64   | `SDL2.dll` and `openal.dll`, x64, static C runtime, unsigned                | `win-x64` self-contained publish on any system, icon, version and manifest included; NativeAOT only on Windows           | Folder in a zip               | None                                                                                                      | SmartScreen warns on downloads and allows a bypass by default; Smart App Control blocks it with no per-app override                    |
| Windows arm64 | `SDL2.dll` and `openal.dll`, ARM64, MonoGame's own builds, unsigned         | `win-arm64` publish on any system; NativeAOT only on Windows with the ARM64 C++ tools                                    | Folder in a zip               | None                                                                                                      | As x64; OpenGL from the GPU driver or Microsoft's compatibility pack (unconfirmed); the x64 build also runs under emulation            |
| Linux x64     | `libSDL2-2.0.so.0` and `libopenal.so`; glibc 2.34 and GCC 11's libstdc++    | `linux-x64` publish on any system, executable bit set only off Windows; NativeAOT only on Linux                          | Folder in a `.tar.gz`         | None                                                                                                      | Extract and run; needs glibc 2.34 or later, ICU or invariant mode, X11 or XWayland, an OpenGL driver, and PipeWire, PulseAudio or ALSA |
| Linux arm64   | The same, for aarch64                                                       | `linux-arm64` publish on any system; NativeAOT on arm64 Linux or with a cross toolchain                                  | Folder in a `.tar.gz`         | None                                                                                                      | As x64; MonoGame's CI tests this target under `xvfb-run`                                                                               |

## Open points

- Running the Windows and Linux exports, including on Windows on Arm. Only the macOS builds ran here.
- OpenGL on Windows on Arm: native drivers or Microsoft's compatibility pack, which version, and what `windows-11-arm` runners provide. MonoGame's CI runs its game tests on GitHub-hosted runners only on Linux, under `xvfb-run`, and skips them on hosted Windows and macOS ([CI][mg-ci]).
- What Gatekeeper shows for a downloaded ad-hoc universal app on a fresh macOS 15 Mac, and what AirDrop and a USB stick do.
- Building and signing the bundle on Windows or Linux with `llvm-lipo` and `rcodesign`, and making `.icns` files without `iconutil`.
- Whether `LSMinimumSystemVersion` 15.0 gives a clear refusal on macOS 14 and earlier.
- Trimming and NativeAOT with real game code: reflection, JSON and content readers.
- How Linux file managers start an extracted executable, and window icons on Wayland with SDL2.
- Whether the roadmap's Windows minimum moves on from 23H2.

[ticket]: https://github.com/softhatgames/playstead/issues/84
[roadmap]: ../ROADMAP.md#versions-after-01
[mg-release]: https://github.com/MonoGame/MonoGame/releases/tag/v3.8.6
[mg-nuget]: https://www.nuget.org/packages/MonoGame.Framework.DesktopGL/3.8.6
[mg-template]: https://www.nuget.org/packages/MonoGame.Templates.CSharp/3.8.6
[mg-cb-task]: https://www.nuget.org/packages/MonoGame.Content.Builder.Task/3.8.6
[mg-platforms]: https://docs.monogame.net/articles/getting_started/platforms.html
[mg-packaging]: https://docs.monogame.net/articles/getting_started/packaging_games.html
[mg-funcloader]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/Utilities/FuncLoader.Desktop.cs
[mg-openal]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/Audio/OpenAL.cs
[mg-titlecontainer]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/TitleContainer.Desktop.cs
[mg-gdm]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/GraphicsDeviceManager.SDL.cs
[mg-glcontext]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/Graphics/GraphicsContext.SDL.cs
[mg-window]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/MonoGame.Framework/Platform/SDL/SDLGameWindow.cs
[mg-ci]: https://github.com/MonoGame/MonoGame/blob/v3.8.6/.github/workflows/main.yml
[mg-9047]: https://github.com/MonoGame/MonoGame/issues/9047
[sdl-lib-ci]: https://github.com/MonoGame/MonoGame.Library.SDL/blob/2.32.10.2/.github/workflows/main.yml
[sdl-lib-win]: https://github.com/MonoGame/MonoGame.Library.SDL/blob/2.32.10.2/build/BuildWindowsTask.cs
[sdl-lib-mac]: https://github.com/MonoGame/MonoGame.Library.SDL/blob/2.32.10.2/build/BuildMacOSTask.cs
[openal-lib-ci]: https://github.com/MonoGame/MonoGame.Library.OpenAL/blob/1.24.3.4/.github/workflows/main.yml
[openal-lib-win]: https://github.com/MonoGame/MonoGame.Library.OpenAL/blob/1.24.3.4/build/BuildWindowsTask.cs
[sdl-release]: https://github.com/libsdl-org/SDL/releases/tag/release-2.32.10
[sdl-ci]: https://github.com/libsdl-org/SDL/blob/release-2.32.10/.github/workflows/create-test-plan.py
[sdl-video]: https://github.com/libsdl-org/SDL/blob/release-2.32.10/src/video/SDL_video.c
[openal-release]: https://github.com/kcat/openal-soft/releases/tag/1.24.3
[openal-ci]: https://github.com/kcat/openal-soft/blob/1.24.3/.github/workflows/ci.yml
[openal-readme]: https://github.com/kcat/openal-soft/blob/1.24.3/README.md
[gcc-abi]: https://gcc.gnu.org/onlinedocs/libstdc++/manual/abi.html
[gl-pack]: https://devblogs.microsoft.com/directx/announcing-the-opencl-and-opengl-compatibility-pack-for-windows-10-on-arm/
[rid]: https://learn.microsoft.com/dotnet/core/rid-catalog
[dotnet-publish]: https://learn.microsoft.com/dotnet/core/deploying/
[patch-selection]: https://learn.microsoft.com/dotnet/core/deploying/runtime-patch-selection
[single-file]: https://learn.microsoft.com/dotnet/core/deploying/single-file/overview
[trimming]: https://learn.microsoft.com/dotnet/core/deploying/trimming/trim-self-contained
[r2r]: https://learn.microsoft.com/dotnet/core/deploying/ready-to-run
[aot]: https://learn.microsoft.com/dotnet/core/deploying/native-aot/
[aot-cross]: https://learn.microsoft.com/dotnet/core/deploying/native-aot/cross-compile
[dotnet-macos]: https://learn.microsoft.com/dotnet/core/deploying/macos
[supported-os]: https://github.com/dotnet/core/blob/main/release-notes/10.0/supported-os.md
[dotnet-deps]: https://github.com/dotnet/core/blob/main/release-notes/10.0/dotnet-dependencies.md
[invariant]: https://github.com/dotnet/runtime/blob/main/docs/design/features/globalization-invariant-mode.md
[resource-updater]: https://github.com/dotnet/runtime/pull/89303
[resource-updater-os]: https://github.com/dotnet/runtime/pull/103327
[macho-sign]: https://github.com/dotnet/runtime/pull/108992
[hostwriter]: https://github.com/dotnet/runtime/blob/release/10.0/src/installer/managed/Microsoft.NET.HostModel/AppHost/HostWriter.cs
[sdk-targets]: https://github.com/dotnet/sdk/blob/release/10.0.1xx/src/Tasks/Microsoft.NET.Build.Tasks/targets/Microsoft.NET.Sdk.targets
[sdk9-targets]: https://github.com/dotnet/sdk/blob/release/9.0.1xx/src/Tasks/Microsoft.NET.Build.Tasks/targets/Microsoft.NET.Sdk.targets
[msbuild-props]: https://learn.microsoft.com/visualstudio/msbuild/common-msbuild-project-properties
[llvm-lipo]: https://llvm.org/docs/CommandGuide/llvm-lipo.html
[rcodesign-readme]: https://github.com/indygreg/apple-platform-rs/blob/main/apple-codesign/README.md
[rcodesign-signing]: https://gregoryszorc.com/docs/apple-codesign/stable/apple_codesign_rcodesign_signing.html
[rcodesign-release]: https://github.com/indygreg/apple-platform-rs/releases/tag/apple-codesign%2F0.29.0
[gh-runners]: https://docs.github.com/actions/reference/runners/github-hosted-runners
[apple-placing]: https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle
[apple-bigsur]: https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes
[apple-rosetta]: https://developer.apple.com/documentation/apple-silicon/about-the-rosetta-translation-environment
[apple-lsmin]: https://developer.apple.com/documentation/bundleresources/information-property-list/lsminimumsystemversion
[apple-gatekeeper]: https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web
[apple-sequoia]: https://developer.apple.com/news/?id=saqachfa
[apple-open-anyway]: https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/15.0/mac/15.0
[apple-safely-open]: https://support.apple.com/en-us/102445
[apple-quarantine]: https://developer.apple.com/library/archive/releasenotes/Carbon/RN-LaunchServices/
[eclectic-quarantine]: https://eclecticlight.co/2020/10/29/quarantine-and-the-quarantine-flag/
[smartscreen]: https://learn.microsoft.com/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/
[smartscreen-settings]: https://learn.microsoft.com/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/available-settings
[sac]: https://learn.microsoft.com/windows/apps/develop/smart-app-control/overview
[sac-faq]: https://support.microsoft.com/windows/smart-app-control-frequently-asked-questions-285ea03d-fa88-4d56-882e-6698afdb7003
[win11-release]: https://learn.microsoft.com/windows/release-health/windows11-release-information
[appimage-fuse]: https://docs.appimage.org/user-guide/troubleshooting/fuse.html
[appimage-runtime]: https://github.com/AppImage/type2-runtime
[appimagetool]: https://github.com/AppImage/appimagetool
[appimage-appdir]: https://docs.appimage.org/reference/appdir.html
[appimage-best]: https://docs.appimage.org/reference/best-practices.html
[desktop-entry]: https://specifications.freedesktop.org/desktop-entry/latest/
[desktop-entry-naming]: https://specifications.freedesktop.org/desktop-entry/latest/file-naming.html
[ubuntu-libc]: https://packages.ubuntu.com/jammy/libc6
[rhel8-glibc]: https://access.redhat.com/errata/RHBA-2024:3152
[rhel9-glibc]: https://access.redhat.com/errata/RHBA-2025:20947
[sles-glibc]: https://www.suse.com/security/cve/CVE-2022-39046
