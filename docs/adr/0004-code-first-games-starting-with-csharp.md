# Code-first games, starting with C#

Games made with Playstead are written as code on proven libraries, each with its own engine, without an off-the-shelf engine such as Unity, Godot or Unreal. Playstead supports a few stacks, each a language with its libraries, skills and Playstead library. The first is C# on .NET 10, the current long-term support release, and it is the default for people without a preference. The stack is not fixed: another is added when a real game needs it.

Code-first means the agent can read and change everything, the engine can follow the structure in [ADR 0003](0003-game-state-in-the-games-playstead-builds.md), and the game can carry its [development layer](0002-the-development-layer.md). An off-the-shelf engine keeps its state model, editor and build to itself.

C# reaches desktop, iPhone and Android, and its game libraries ship on consoles. MonoGame and FNA keep an XNA-derived interface that has been stable for over fifteen years, so agents know it well. `dotnet watch` Hot Reload applies changed method bodies and new members to a running process, which gives code the fast iteration that content reload gives tuning.

C# is the decision; the library is not. MonoGame is the first to try. A technical prototype on .NET 10 measures the preview's frame delay, checks code reload inside a running game loop, checks a GPU context, audio and input under Playstead's permissions on macOS and Windows, and checks replay across machines, including .NET's maths functions and a physics library. If code reload does not take effect inside MonoGame's game loop, another C# library is considered before another language. The [game stacks](../research/game-stacks.md) note records the evidence.

## Considered options

- **Rust**, with macroquad, rebuilds a small game faster, and Bevy offers more. Neither has a public console path, Bevy's breaking releases work against agents, and each prototype copy starts with a cold build folder.
- **TypeScript** suits a browser preview, which native frames make unnecessary, and reaches phones and consoles only through wrappers.
