using PreviewProbe;

// Usage: PreviewProbe [--preview <socket path or \\.\pipe\name>] [--frames raw|iosurface|d3d11] [--show-window]
// Without --preview the game runs as Play: its own window, nothing sent.
// --frames iosurface (DesktopGL on macOS) or d3d11 (WindowsDX) shares frames
// on the GPU instead of sending pixels.
string? preview = null;
var frames = "raw";
var showWindow = false;
for (var i = 0; i < args.Length; i++)
{
    if (args[i] == "--preview" && i + 1 < args.Length)
        preview = args[++i];
    else if (args[i] == "--frames" && i + 1 < args.Length)
        frames = args[++i];
    else if (args[i] == "--show-window")
        showWindow = true;
}

using var game = new ProbeGame(preview, frames, showWindow);
game.Run();
