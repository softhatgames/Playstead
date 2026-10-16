import type { ProviderDriverKind } from "@playstead/contracts/providerInstance";
import type {
  ServerProvider,
  ServerProviderCompatibilityAdvisory,
  ServerProviderCompatibilityStatus,
} from "@playstead/contracts/server";
import { identity } from "@playstead/shared/identity";

interface CompatibilityPolicy {
  readonly recommendedRange: string;
  readonly ranges: ReadonlyArray<{
    readonly range: string;
    readonly status: Exclude<ServerProviderCompatibilityStatus, "unknown">;
  }>;
}

/**
 * T3 Code's supported ranges at 2577baf, from the `compatibility` policies in
 * `apps/server/src/provider/model-manifest.json` that match its own version.
 * T3 Code also fetches that manifest from GitHub every hour; Playstead keeps
 * these ranges fixed and fetches nothing. They move with the followed commit.
 */
const COMPATIBILITY_POLICIES: Record<ProviderDriverKind, CompatibilityPolicy> = {
  codex: {
    recommendedRange: ">=0.159.0",
    ranges: [
      { range: ">=0.156.0", status: "supported" },
      { range: ">=0.149.0 <0.156.0", status: "unsupported" },
      { range: "<0.149.0", status: "broken" },
    ],
  },
  claudeAgent: {
    recommendedRange: ">=2.1.280",
    ranges: [
      { range: ">=2.1.280", status: "supported" },
      { range: ">=2.1.111 <2.1.280", status: "graceful" },
      { range: "<2.1.111", status: "unsupported" },
    ],
  },
};

type Version = readonly [number, number, number];

export const parseStableVersion = (value: string): Version | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};

export const compareVersions = (left: Version, right: Version) =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

/** The ranges above use only `>=` and `<` comparators, joined by spaces. */
const satisfiesRange = (version: Version, range: string) =>
  range.split(/\s+/).every((comparator) => {
    const match = /^(>=|<)(\d+\.\d+\.\d+)$/.exec(comparator);
    const bound = match ? parseStableVersion(match[2]!) : undefined;
    if (!match || !bound) return false;
    const order = compareVersions(version, bound);
    return match[1] === ">=" ? order >= 0 : order < 0;
  });

const release = `this ${identity.productName.production} release`;

/** T3 Code's messages (`providerCompatibility.ts` at 2577baf), naming Playstead's release. */
const MESSAGES: Partial<Record<ServerProviderCompatibilityStatus, string>> = {
  broken: `This provider version is known to be incompatible with ${release}.`,
  unsupported: `This provider version is outside the supported range for ${release}.`,
  graceful: `This provider version has limited compatibility with ${release}.`,
};

/**
 * Classifies a version as T3 Code's `resolveProviderCompatibility` does: a
 * leading `v` is dropped, and anything but a plain `x.y.z`, such as a
 * prerelease, is unknown.
 */
function resolveProviderCompatibility(
  driver: ProviderDriverKind,
  version: string | null,
): ServerProviderCompatibilityAdvisory {
  const policy = COMPATIBILITY_POLICIES[driver];
  const stable = version === null ? undefined : parseStableVersion(version.replace(/^v/, ""));
  const status =
    stable === undefined
      ? "unknown"
      : (policy.ranges.find((entry) => satisfiesRange(stable, entry.range))?.status ?? "unknown");
  const message = MESSAGES[status];
  return {
    status,
    message: message === undefined ? null : `${message} Use ${policy.recommendedRange}.`,
    recommendedVersion: null,
    recommendedRange: policy.recommendedRange,
  };
}

/** Only an installed provider gets an advisory. */
export function applyProviderCompatibility(snapshot: ServerProvider): ServerProvider {
  const { compatibilityAdvisory: _previous, ...base } = snapshot;
  if (!snapshot.installed) return base;
  return {
    ...base,
    compatibilityAdvisory: resolveProviderCompatibility(snapshot.driver, snapshot.version),
  };
}
