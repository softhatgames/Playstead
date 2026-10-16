[assembly: System.Reflection.Metadata.MetadataUpdateHandler(typeof(PreviewProbe.ReloadNotifier))]

namespace PreviewProbe;

/// <summary>Called by .NET Hot Reload after it applies changed code to the running game.</summary>
static class ReloadNotifier
{
    public static event Action<Type[]?>? Applied;

    internal static void UpdateApplication(Type[]? updatedTypes) => Applied?.Invoke(updatedTypes);
}
