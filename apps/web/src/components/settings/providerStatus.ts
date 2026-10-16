import type { ServerProvider } from "@playstead/contracts/server";

/**
 * What a provider card says, following T3 Code's
 * `apps/web/src/components/settings/providerStatus.ts` at 2577baf, without
 * the disabled state and update advisories.
 */
export function getProviderSummary(provider: ServerProvider | undefined): {
  readonly headline: string;
  readonly detail: string | null;
} {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation details.",
    };
  }
  if (!provider.installed) {
    return { headline: "Not found", detail: provider.message ?? "CLI not detected on PATH." };
  }
  const authLabel = provider.auth.label ?? provider.auth.type;
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: authLabel ? `Not authenticated · ${authLabel}` : "Not authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  if (provider.auth.status === "authenticated") {
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : "Authenticated",
      detail: provider.message ?? null,
    };
  }
  return { headline: "Available", detail: provider.message ?? null };
}

export const PROVIDER_STATUS_DOT = {
  ready: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
} as const;

export function getProviderVersionLabel(version: string | null | undefined): string | null {
  if (!version) return null;
  return /^\d/.test(version) ? `v${version}` : version;
}

const COMPATIBILITY_TITLES = {
  graceful: "Limited support",
  unsupported: "Unsupported version",
  broken: "Known broken version",
} as const;

/** T3 Code's compatibility warning: shown for any status but supported and unknown. */
export function getCompatibilityWarning(provider: ServerProvider): {
  readonly title: string;
  readonly detail: string;
  readonly emphasis: "normal" | "strong";
} | null {
  const advisory = provider.compatibilityAdvisory;
  if (
    advisory === undefined ||
    (advisory.status !== "graceful" &&
      advisory.status !== "unsupported" &&
      advisory.status !== "broken")
  ) {
    return null;
  }
  const recommendation =
    getProviderVersionLabel(advisory.recommendedVersion) ?? advisory.recommendedRange;
  return {
    title: COMPATIBILITY_TITLES[advisory.status],
    detail:
      advisory.message ??
      (recommendation ? `Use ${recommendation} for full support.` : "Update for full support."),
    emphasis: advisory.status === "graceful" ? "normal" : "strong",
  };
}
