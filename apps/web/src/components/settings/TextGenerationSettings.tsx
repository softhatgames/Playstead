import { DEFAULT_TEXT_GENERATION_MODELS } from "@playstead/contracts/settings";
import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import { useState } from "react";
import { requestPrimary, usePrimaryConnectionState } from "../../connection/runtime.ts";
import { failureToast } from "../../toast.ts";

/** T3 Code's General → Text generation, limited to Playstead's two built-in providers. */
export function TextGenerationSettings() {
  const config = usePrimaryConnectionState()?.config;
  const [saving, setSaving] = useState(false);
  const selection =
    config?.settings.textGenerationModelSelection ?? DEFAULT_TEXT_GENERATION_MODELS.codex;
  const provider = config?.providers.find((p) => p.instanceId === selection.instanceId);
  const models = provider?.models ?? [];
  const save = async (next: ModelSelection) => {
    setSaving(true);
    try {
      await requestPrimary((client) =>
        client["server.updateSettings"]({ textGenerationModelSelection: next }),
      );
    } catch (error) {
      failureToast("Failed to save text generation settings", error);
    } finally {
      setSaving(false);
    }
  };
  const inputClass =
    "rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700";
  return (
    <section aria-labelledby="settings-text-generation" className="flex flex-col gap-3">
      <h2 id="settings-text-generation" className="text-sm font-medium">
        Text generation
      </h2>
      <p className="text-xs text-neutral-500">
        Provider and model for thread titles. If unavailable, Playstead uses Codex, then Claude.
      </p>
      <fieldset disabled={!config || saving} className="flex flex-wrap items-center gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Provider
          <select
            aria-label="Text generation provider"
            className={inputClass}
            value={selection.instanceId}
            onChange={(event) => {
              const id = event.target.value;
              if (id === "codex" || id === "claudeAgent")
                void save(DEFAULT_TEXT_GENERATION_MODELS[id]);
            }}
          >
            <option value="codex">Codex</option>
            <option value="claudeAgent">Claude</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Model
          <select
            aria-label="Text generation model"
            className={inputClass}
            value={selection.model}
            onChange={(event) => void save({ ...selection, model: event.target.value })}
          >
            {models.some((m) => m.slug === selection.model) ? null : (
              <option value={selection.model}>{selection.model}</option>
            )}
            {models.map((model) => (
              <option key={model.slug} value={model.slug}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
        {selection.instanceId === "codex" ? (
          <label className="flex flex-col gap-1 text-xs">
            Reasoning effort
            <select
              aria-label="Text generation reasoning effort"
              className={inputClass}
              value={String(
                selection.options?.find((o) => o.id === "reasoningEffort")?.value ?? "low",
              )}
              onChange={(event) =>
                void save({
                  ...selection,
                  options: [{ id: "reasoningEffort", value: event.target.value }],
                })
              }
            >
              {["minimal", "low", "medium", "high", "xhigh"].map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="text-xs hover:underline"
          onClick={() => void save(DEFAULT_TEXT_GENERATION_MODELS.codex)}
        >
          Reset
        </button>
      </fieldset>
    </section>
  );
}
