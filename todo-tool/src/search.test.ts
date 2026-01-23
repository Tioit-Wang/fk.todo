import { describe, expect, it } from "vitest";

import type { Task } from "./types";
import { taskMatchesQuery } from "./search";

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "t",
    project_id: "inbox",
    title: "Write weekly report",
    due_at: now,
    important: false,
    completed: false,
    created_at: now,
    updated_at: now,
    sort_order: now * 1000,
    quadrant: 1,
    notes: "Collect highlights and blockers",
    steps: [{ id: "s1", title: "Draft", completed: false, created_at: now }],
    tags: ["work", "weekly"],
    reminder: { kind: "none", forced_dismissed: false },
    repeat: { type: "none" },
    ...overrides,
  };
}

describe("taskMatchesQuery", () => {
  it("matches by title", () => {
    expect(taskMatchesQuery(makeTask(), "weekly")).toBe(true);
  });

  it("matches by notes", () => {
    expect(taskMatchesQuery(makeTask(), "blockers")).toBe(true);
  });

  it("matches by step title", () => {
    expect(taskMatchesQuery(makeTask(), "draft")).toBe(true);
  });

  it("matches by tag", () => {
    expect(taskMatchesQuery(makeTask(), "#work")).toBe(true);
    expect(taskMatchesQuery(makeTask(), "work")).toBe(true);
  });

  it("requires all tokens to match", () => {
    expect(taskMatchesQuery(makeTask(), "weekly blockers")).toBe(true);
    expect(taskMatchesQuery(makeTask(), "weekly missing")).toBe(false);
  });
});
