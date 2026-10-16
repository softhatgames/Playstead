import type { ServerProvider } from "@playstead/contracts/server";
import { assert, describe, it } from "@effect/vitest";

import {
  getCompatibilityWarning,
  getProviderSummary,
  getProviderVersionLabel,
} from "./providerStatus.ts";

const codex = (overrides: Partial<ServerProvider>): ServerProvider => ({
  instanceId: "codex",
  driver: "codex",
  displayName: "Codex",
  installed: true,
  version: "0.160.0",
  status: "ready",
  auth: { status: "unknown" },
  checkedAt: "2026-10-16T12:00:00.000Z",
  models: [],
  ...overrides,
});

describe("getProviderSummary", () => {
  it("says the status is being checked before the server reports it", () => {
    assert.strictEqual(getProviderSummary(undefined).headline, "Checking provider status");
  });

  it("says a provider missing from PATH was not found, with the server's hint", () => {
    assert.deepStrictEqual(
      getProviderSummary(
        codex({
          installed: false,
          version: null,
          status: "error",
          message: "Could not start Codex CLI.",
        }),
      ),
      { headline: "Not found", detail: "Could not start Codex CLI." },
    );
  });

  it("says an installed provider that failed its check is unavailable", () => {
    assert.strictEqual(
      getProviderSummary(codex({ status: "error", message: "probe failed" })).headline,
      "Unavailable",
    );
  });

  it("says a signed-out provider is not authenticated, with the server's advice", () => {
    assert.deepStrictEqual(
      getProviderSummary(
        codex({
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Codex CLI is not authenticated. Run `codex login` and try again.",
        }),
      ),
      {
        headline: "Not authenticated",
        detail: "Codex CLI is not authenticated. Run `codex login` and try again.",
      },
    );
  });

  it("says a signed-in provider is authenticated, naming the account's kind", () => {
    assert.deepStrictEqual(
      getProviderSummary(
        codex({
          auth: {
            status: "authenticated",
            type: "chatgpt",
            label: "ChatGPT Plus Subscription",
            email: "person@example.com",
          },
        }),
      ),
      { headline: "Authenticated · ChatGPT Plus Subscription", detail: null },
    );
  });

  it("says a found provider is available", () => {
    assert.deepStrictEqual(getProviderSummary(codex({})), { headline: "Available", detail: null });
  });
});

describe("getCompatibilityWarning", () => {
  it("warns strongly about an unsupported version, with the server's message", () => {
    assert.deepStrictEqual(
      getCompatibilityWarning(
        codex({
          version: "0.150.0",
          compatibilityAdvisory: {
            status: "unsupported",
            message:
              "This provider version is outside the supported range for this Playstead release. Use >=0.159.0.",
            recommendedVersion: null,
            recommendedRange: ">=0.159.0",
          },
        }),
      ),
      {
        title: "Unsupported version",
        detail:
          "This provider version is outside the supported range for this Playstead release. Use >=0.159.0.",
        emphasis: "strong",
      },
    );
  });

  it("notes limited support gently", () => {
    const warning = getCompatibilityWarning(
      codex({
        compatibilityAdvisory: {
          status: "graceful",
          message:
            "This provider version has limited compatibility with this Playstead release. Use >=2.1.280.",
          recommendedVersion: null,
          recommendedRange: ">=2.1.280",
        },
      }),
    );
    assert.strictEqual(warning?.title, "Limited support");
    assert.strictEqual(warning?.emphasis, "normal");
  });

  it("says nothing about a supported or unknown version", () => {
    const advisory = { message: null, recommendedVersion: null, recommendedRange: ">=0.159.0" };
    assert.isNull(
      getCompatibilityWarning(
        codex({ compatibilityAdvisory: { status: "supported", ...advisory } }),
      ),
    );
    assert.isNull(
      getCompatibilityWarning(codex({ compatibilityAdvisory: { status: "unknown", ...advisory } })),
    );
  });
});

describe("getProviderVersionLabel", () => {
  it("prefixes a version with v", () => {
    assert.strictEqual(getProviderVersionLabel("2.1.301"), "v2.1.301");
    assert.isNull(getProviderVersionLabel(null));
  });
});
