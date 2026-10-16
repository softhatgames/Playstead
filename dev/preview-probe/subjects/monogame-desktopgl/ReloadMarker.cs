namespace PreviewProbe;

// The probe's reload check edits this file while the game runs, then restores
// it. Each edit, listed in subject.json, changes Value() and the colour of the
// panel it selects. Keep the text the edits search for unchanged.
public static class ReloadMarker
{
    static readonly Func<int> FromLambda = () => 0;

    public static int Value()
    {
        return FromLambda() + 1 + Restarted();
    }

    // The runtime cannot change a loaded class's base type, so changing
    // RestartMarker's needs a restart.
    static int Restarted() => typeof(RestartMarker).BaseType == typeof(OneMore) ? 1 : 0;
}

class OneMore { }

class RestartMarker { }
