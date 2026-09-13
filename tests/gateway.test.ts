import { describe, expect, it } from "vitest";
import { closestModelIds, isReasoningTextModel } from "../src/gateway.js";

describe("the live list is text models that can reason (D78)", () => {
  it("keeps a language model the catalog marks as reasoning", () => {
    expect(
      isReasoningTextModel({
        id: "qwen/qwen3-235b-a22b",
        type: "language",
        tags: ["reasoning"],
      }),
    ).toBe(true);
    expect(
      isReasoningTextModel({
        id: "openai/gpt-oss-120b",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: ["include_reasoning", "reasoning"],
      }),
    ).toBe(true);
  });

  it("drops embeddings, images, and chat models with no reasoning mark", () => {
    expect(isReasoningTextModel({ id: "openai/text-embedding-3-large", type: "embedding" })).toBe(
      false,
    );
    expect(
      isReasoningTextModel({
        id: "openai/gpt-4o",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["temperature"],
      }),
    ).toBe(false);
    expect(
      isReasoningTextModel({
        id: "black-forest-labs/flux",
        architecture: { output_modalities: ["image"] },
        tags: ["reasoning"],
      }),
    ).toBe(false);
  });

  it("names close models when the one asked for is not on the list", () => {
    const catalog = [
      { id: "qwen/qwen3-235b-a22b" },
      { id: "openai/gpt-oss-120b" },
      { id: "moonshotai/kimi-k2" },
    ];
    expect(closestModelIds("qwen/qwen3", catalog)[0]).toBe("qwen/qwen3-235b-a22b");
    expect(closestModelIds("gpt-oss", catalog)).toContain("openai/gpt-oss-120b");
  });
});
