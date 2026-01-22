import { describe, expect, it } from "vitest";

import { extractTagsFromTitle, normalizeTag } from "./tags";

describe("normalizeTag", () => {
  it("returns null for empty input", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });

  it("strips leading # and trims punctuation", () => {
    expect(normalizeTag("#work,")).toBe("work");
    expect(normalizeTag("  #本周。  ")).toBe("本周");
  });

  it("lowercases ASCII tags", () => {
    expect(normalizeTag("WORK")).toBe("work");
    expect(normalizeTag("#Work_OK")).toBe("work_ok");
  });
});

describe("extractTagsFromTitle", () => {
  it("extracts #tags and keeps remaining title", () => {
    const res = extractTagsFromTitle("写周报 #work #本周");
    expect(res.title).toBe("写周报");
    expect(res.tags).toEqual(["work", "本周"]);
  });

  it("deduplicates tags", () => {
    const res = extractTagsFromTitle("A #work #WORK #work");
    expect(res.title).toBe("A");
    expect(res.tags).toEqual(["work"]);
  });
});

