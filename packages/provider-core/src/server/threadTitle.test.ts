import { assert, describe, it } from "@effect/vitest";

import { buildThreadTitlePrompt } from "./textGenerationPrompts.ts";
import { sanitizeThreadTitle, toJsonSchemaObject } from "./textGenerationUtils.ts";
import { formatThreadTitleContext, limitTitleMessage } from "./threadTitleContext.ts";

/**
 * What a provider is asked for a thread's title and what comes back to the
 * sidebar, ported as behaviour from T3 Code's `textGenerationPrompts.test.ts`,
 * `threadTitleContext.test.ts` and `ThreadTitleRegenerationService.test.ts`
 * at 2577baf. Attachments and linked context are absent.
 */

describe("the title prompt", () => {
  it("asks for a title and a refinement flag, both required", () => {
    const { outputSchema } = buildThreadTitlePrompt({ message: "Fix this" });
    const schema = toJsonSchemaObject(outputSchema) as {
      readonly required: ReadonlyArray<string>;
      readonly properties: Record<string, { readonly type: string }>;
    };
    assert.deepStrictEqual(schema.required, ["title", "needsRefinement"]);
    assert.strictEqual(schema.properties.title?.type, "string");
    assert.strictEqual(schema.properties.needsRefinement?.type, "boolean");
  });

  it("titles a new thread from its first message, naming Playstead", () => {
    const { prompt } = buildThreadTitlePrompt({
      message: "Make the player jump higher on the moon level",
    });
    assert.include(prompt, "Playstead");
    assert.notInclude(prompt, "T3 Code");
    assert.include(prompt, "User message:\nMake the player jump higher on the moon level");
    assert.notInclude(prompt, "Previous title");
  });

  it("keeps the start and the end of a first message too long to send whole", () => {
    const message = `Start of the request. ${"filler ".repeat(2_000)}End of the request.`;
    const { prompt } = buildThreadTitlePrompt({ message });
    assert.include(prompt, "Start of the request.");
    assert.include(prompt, "End of the request.");
    assert.include(prompt, "[Content truncated]");
  });

  it("regenerates from the thread's contents and names the previous title", () => {
    const { prompt } = buildThreadTitlePrompt({
      message:
        "USER:\nMake the player jump higher\n\nASSISTANT:\nThe gravity constant was too high",
      previousTitle: "Player jump height",
    });
    assert.include(prompt, 'The previous title was "Player jump height".');
    assert.include(prompt, "Thread contents:\n");
    assert.include(prompt, "The gravity constant was too high");
    assert.notInclude(prompt, "User message:");
  });

  it("keeps the latest contents when a regenerate's context is too long", () => {
    const { prompt } = buildThreadTitlePrompt({
      message: `${"old context ".repeat(1_000)}\n\nASSISTANT:\nCurrent thread state`,
      previousTitle: "Old title",
    });
    assert.include(prompt, "[Earlier content truncated]");
    assert.include(prompt, "Current thread state");
  });

  it("does not mark a regenerate's context truncated twice", () => {
    const kept = "x".repeat(7_998);
    const { prompt } = buildThreadTitlePrompt({
      message: `[Earlier content truncated]\n\n${kept}`,
      previousTitle: "Old title",
    });
    assert.include(prompt, `Thread contents:\n[Earlier content truncated]\n\n${kept}`);
    assert.lengthOf(prompt.match(/\[Earlier content truncated\]/g) ?? [], 1);
  });
});

describe("a generated title", () => {
  it("is the first line, without quotes or extra spaces", () => {
    assert.strictEqual(
      sanitizeThreadTitle('  "Moon level   jump height"  \nignored line'),
      "Moon level jump height",
    );
    assert.strictEqual(sanitizeThreadTitle(`  "' hello world '"  `), "hello world");
  });

  it("is unwrapped when the provider answers with the JSON object", () => {
    assert.strictEqual(sanitizeThreadTitle('{"title": "  Fix   the jump  "}'), "Fix the jump");
    assert.strictEqual(
      sanitizeThreadTitle('{\n  "title": "Refresh the sprite sheet"\n}'),
      "Refresh the sprite sheet",
    );
  });

  it("keeps text that only looks like JSON", () => {
    for (const raw of ["Fix {title} interpolation", '{"title": 42}', '{"title": "unfinished}']) {
      assert.strictEqual(sanitizeThreadTitle(raw), raw);
    }
  });

  it('is "New thread" when nothing is left', () => {
    assert.strictEqual(sanitizeThreadTitle('  """   """  '), "New thread");
    assert.strictEqual(sanitizeThreadTitle('{"title": "  "}'), "New thread");
  });

  it("is cut to 120 characters, ending in an ellipsis", () => {
    const words = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
    const title = sanitizeThreadTitle(words);
    assert.isAtMost(title.length, 120);
    assert.isTrue(title.endsWith("..."));
  });
});

describe("a regenerate's context", () => {
  it("is the conversation, labelled by role, when it is short", () => {
    assert.deepStrictEqual(
      formatThreadTitleContext([
        { role: "user", text: "Fix the jump" },
        { role: "assistant", text: "Gravity was too high." },
      ]),
      { message: "USER:\nFix the jump\n\nASSISTANT:\nGravity was too high." },
    );
    assert.deepStrictEqual(formatThreadTitleContext([]), { message: "" });
  });

  it("skips empty messages", () => {
    assert.strictEqual(
      formatThreadTitleContext([
        { role: "user", text: "First question" },
        { role: "assistant", text: "  " },
        { role: "assistant", text: "Second answer" },
      ]).message,
      "USER:\nFirst question\n\nASSISTANT:\nSecond answer",
    );
  });

  it("keeps the person's change of subject despite long answers", () => {
    const { message } = formatThreadTitleContext([
      { role: "user", text: "Review the save system" },
      { role: "assistant", text: "Old findings. ".repeat(2_000) },
      { role: "user", text: "Focus on the autosave timer instead." },
      { role: "assistant", text: "Implementation details. ".repeat(2_000) },
      { role: "user", text: "Ship it when it works." },
    ]);
    assert.isAtMost(message.length, 8_000);
    assert.include(message, "USER:\nReview the save system");
    assert.include(message, "USER:\nFocus on the autosave timer instead.");
    assert.include(message, "USER:\nShip it when it works.");
    assert.include(message, "ASSISTANT:\nImplementation details.");
    assert.isTrue(message.startsWith("[Earlier content truncated]\n\n"));
  });

  it("keeps both ends of a long message", () => {
    const { message } = formatThreadTitleContext([
      { role: "user", text: `Fix the jump. ${"logs ".repeat(3_000)}Keep the double jump.` },
      { role: "assistant", text: "Found the cause." },
    ]);
    assert.include(message, "USER:\nFix the jump.");
    assert.include(message, "Keep the double jump.");
    assert.include(message, "[Content truncated]");
    assert.include(message, "ASSISTANT:\nFound the cause.");
  });

  it("never exceeds a tiny budget", () => {
    assert.strictEqual(limitTitleMessage("x".repeat(100), 0), "");
    for (let budget = 1; budget < 40; budget++) {
      assert.isAtMost(limitTitleMessage("x".repeat(100), budget).length, budget);
    }
  });
});
