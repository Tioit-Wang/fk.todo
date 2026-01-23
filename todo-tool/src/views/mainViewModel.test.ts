import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import {
  buildCompletionSections,
  cycleMainSort,
  filterTasksByQuery,
  filterTasksByScope,
  findManualReorderTargetIndex,
  sortTasksWithPinnedImportant,
} from "./mainViewModel";

function toSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  const now = 1_700_000_000;
  return {
    id,
    project_id: "inbox",
    title: id,
    due_at: now,
    important: false,
    completed: false,
    completed_at: undefined,
    created_at: now,
    updated_at: now,
    sort_order: now * 1000,
    quadrant: 1,
    notes: undefined,
    steps: [],
    tags: [],
    sample_tag: undefined,
    reminder: { kind: "none", forced_dismissed: false },
    repeat: { type: "none" },
    ...overrides,
  };
}

describe("mainViewModel", () => {
  it("cycleMainSort cycles due -> created -> manual -> due", () => {
    expect(cycleMainSort("due")).toBe("created");
    expect(cycleMainSort("created")).toBe("manual");
    expect(cycleMainSort("manual")).toBe("due");
  });

  it("filterTasksByScope(today) keeps due today tasks and overdue incomplete tasks", () => {
    const now = new Date(2026, 0, 23, 10, 0, 0);
    const dueToday = toSeconds(new Date(2026, 0, 23, 18, 0, 0));
    const overdueDue = toSeconds(new Date(2026, 0, 22, 18, 0, 0));
    const dueTomorrow = toSeconds(new Date(2026, 0, 24, 18, 0, 0));

    const dueTodayOpen = makeTask("today-open", { due_at: dueToday });
    const dueTodayDone = makeTask("today-done", {
      due_at: dueToday,
      completed: true,
      completed_at: dueToday,
    });
    const overdueOpen = makeTask("overdue-open", { due_at: overdueDue });
    const overdueDone = makeTask("overdue-done", {
      due_at: overdueDue,
      completed: true,
      completed_at: overdueDue,
    });
    const tomorrow = makeTask("tomorrow", { due_at: dueTomorrow });

    const out = filterTasksByScope(
      [tomorrow, overdueDone, dueTodayDone, overdueOpen, dueTodayOpen],
      { kind: "today" },
      now,
    );

    expect(out.map((t) => t.id)).toEqual([
      "today-done",
      "overdue-open",
      "today-open",
    ]);
  });

  it("filterTasksByScope(important) keeps only important tasks", () => {
    const now = new Date(2026, 0, 23, 10, 0, 0);
    const important = makeTask("i", { important: true });
    const normal = makeTask("n", { important: false });
    const out = filterTasksByScope(
      [normal, important],
      { kind: "important" },
      now,
    );
    expect(out.map((t) => t.id)).toEqual(["i"]);
  });

  it("filterTasksByScope(project) keeps only matching project_id tasks", () => {
    const now = new Date(2026, 0, 23, 10, 0, 0);
    const p1a = makeTask("p1a", { project_id: "p1" });
    const p1b = makeTask("p1b", { project_id: "p1" });
    const p2 = makeTask("p2", { project_id: "p2" });
    const out = filterTasksByScope(
      [p2, p1a, p1b],
      { kind: "project", projectId: "p1" },
      now,
    );
    expect(out.map((t) => t.id)).toEqual(["p1a", "p1b"]);
  });

  it("filterTasksByQuery returns the same list when query is blank", () => {
    const tasks = [makeTask("a"), makeTask("b")];
    expect(filterTasksByQuery(tasks, "   ")).toBe(tasks);
  });

  it("filterTasksByQuery matches title/notes/steps/tags tokens", () => {
    const a = makeTask("a", { title: "Alpha beta", tags: ["work"] });
    const b = makeTask("b", { title: "Gamma", notes: "beta appears here" });
    const c = makeTask("c", {
      title: "Nope",
      steps: [
        { id: "s1", title: "beta step", completed: false, created_at: 1 },
      ],
    });
    const d = makeTask("d", { title: "Other" });

    expect(filterTasksByQuery([a, b, c, d], "beta").map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(filterTasksByQuery([a, b, c, d], "#work").map((t) => t.id)).toEqual([
      "a",
    ]);
    expect(
      filterTasksByQuery([a, b, c, d], "beta gamma").map((t) => t.id),
    ).toEqual(["b"]);
  });

  it("sortTasksWithPinnedImportant pins important tasks and sorts within each group", () => {
    const tasks = [
      makeTask("n2", {
        important: false,
        due_at: 2,
        created_at: 2,
        sort_order: 500,
      }),
      makeTask("i100", {
        important: true,
        due_at: 100,
        created_at: 3,
        sort_order: 30,
      }),
      makeTask("i50", {
        important: true,
        due_at: 50,
        created_at: 1,
        sort_order: 10,
      }),
      makeTask("n1", {
        important: false,
        due_at: 1,
        created_at: 4,
        sort_order: 100,
      }),
    ];

    expect(sortTasksWithPinnedImportant(tasks, "due").map((t) => t.id)).toEqual(
      ["i50", "i100", "n1", "n2"],
    );
    expect(
      sortTasksWithPinnedImportant(tasks, "created").map((t) => t.id),
    ).toEqual(["i50", "i100", "n2", "n1"]);
    expect(
      sortTasksWithPinnedImportant(tasks, "manual").map((t) => t.id),
    ).toEqual(["i50", "i100", "n1", "n2"]);

    // Does not mutate caller-owned arrays.
    expect(tasks.map((t) => t.id)).toEqual(["n2", "i100", "i50", "n1"]);
  });

  it("sortTasksWithPinnedImportant breaks ties deterministically", () => {
    const base = [
      makeTask("b", { important: false, due_at: 10, created_at: 1 }),
      makeTask("a", { important: false, due_at: 10, created_at: 1 }),
      makeTask("d", {
        important: false,
        due_at: 2,
        created_at: 1,
        sort_order: 1,
      }),
      makeTask("c", {
        important: false,
        due_at: 2,
        created_at: 1,
        sort_order: 1,
      }),
    ];

    expect(sortTasksWithPinnedImportant(base, "due").map((t) => t.id)).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
    expect(
      sortTasksWithPinnedImportant(base, "created").map((t) => t.id),
    ).toEqual(["c", "d", "a", "b"]);
    expect(
      sortTasksWithPinnedImportant(base, "manual").map((t) => t.id),
    ).toEqual(["c", "d", "a", "b"]);
  });

  it("buildCompletionSections groups tasks into open/done and keeps open first in all", () => {
    const done = makeTask("done", { completed: true });
    const open1 = makeTask("open1", { completed: false });
    const open2 = makeTask("open2", { completed: false });

    const sections = buildCompletionSections([done, open1, open2]);
    expect(sections.open.map((t) => t.id)).toEqual(["open1", "open2"]);
    expect(sections.done.map((t) => t.id)).toEqual(["done"]);
    expect(sections.all.map((t) => t.id)).toEqual(["open1", "open2", "done"]);
  });

  it("findManualReorderTargetIndex respects pinned important and completion boundaries", () => {
    const list = [
      makeTask("important-open", { important: true, completed: false }),
      makeTask("normal-open-1", { important: false, completed: false }),
      makeTask("normal-open-2", { important: false, completed: false }),
      makeTask("normal-done-1", { important: false, completed: true }),
      makeTask("normal-done-2", { important: false, completed: true }),
    ];

    // Cannot move a normal task above important tasks.
    expect(findManualReorderTargetIndex(list, "normal-open-1", "up")).toBe(
      null,
    );

    // Can reorder within the same importance/completion group.
    expect(findManualReorderTargetIndex(list, "normal-open-2", "up")).toBe(1);
    expect(findManualReorderTargetIndex(list, "normal-open-1", "down")).toBe(2);

    // Cannot move open tasks into done group and vice versa.
    expect(findManualReorderTargetIndex(list, "normal-open-2", "down")).toBe(
      null,
    );
    expect(findManualReorderTargetIndex(list, "normal-done-1", "up")).toBe(
      null,
    );
    expect(findManualReorderTargetIndex(list, "normal-done-1", "down")).toBe(4);
  });
});
