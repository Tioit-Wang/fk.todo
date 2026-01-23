import { useEffect, useRef, useState, type DragEvent } from "react";

import { formatDue } from "../date";
import { formatRepeatRule } from "../repeat";
import type { ReschedulePresetId } from "../reschedule";
import { isOverdue } from "../scheduler";
import type { Task } from "../types";
import { useI18n } from "../i18n";

import { IconButton } from "./IconButton";
import { Icons } from "./icons";

export function TaskCard({
  task,
  mode,
  selectable,
  selected,
  onToggleSelected,
  showMove,
  draggable,
  onDragStart,
  onMoveUp,
  onMoveDown,
  onToggleComplete,
  onToggleImportant,
  onDelete,
  onEdit,
  onReschedulePreset,
  onUpdateTask,
  showNotesPreview,
}: {
  task: Task;
  mode: "quick" | "main";
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  showMove?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onReschedulePreset?: (preset: ReschedulePresetId) => void;
  onUpdateTask?: (next: Task) => Promise<void> | void;
  showNotesPreview?: boolean;
}) {
  const { t } = useI18n();
  const now = Math.floor(Date.now() / 1000);
  const overdue = isOverdue(task, now);
  const overdueFlag = overdue
    ? (() => {
        const delta = Math.max(0, now - task.due_at);
        const days = Math.floor(delta / 86400);
        if (days > 0) return t("task.overdueFlag.days", { days });
        const hours = Math.max(1, Math.floor(delta / 3600));
        return t("task.overdueFlag.hours", { hours });
      })()
    : null;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const canReschedule = Boolean(onReschedulePreset) && !task.completed;
  const [expanded, setExpanded] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const [stepAddOpen, setStepAddOpen] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState("");
  const canEditSteps = Boolean(onUpdateTask) && !task.completed;
  const canSelect = Boolean(selectable) && Boolean(onToggleSelected);
  const stepAddInputRef = useRef<HTMLInputElement | null>(null);

  const showInlineNotes = mode === "main" && Boolean(showNotesPreview);
  const canEditNotes =
    Boolean(onUpdateTask) && !task.completed && showInlineNotes;
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesBusy, setNotesBusy] = useState(false);

  useEffect(() => {
    if (!rescheduleOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const node = event.target as Node | null;
      if (!node) return;
      const wrapper = cardRef.current;
      if (wrapper && !wrapper.contains(node)) {
        setRescheduleOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRescheduleOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [rescheduleOpen]);

  useEffect(() => {
    if (!expanded) {
      setRescheduleOpen(false);
      setStepAddOpen(false);
      setNewStepTitle("");
      return;
    }
    if (stepAddOpen) {
      stepAddInputRef.current?.focus();
    }
  }, [expanded, stepAddOpen]);

  useEffect(() => {
    if (!showInlineNotes) return;
    if (!expanded) return;
    if (notesDirty) return;
    setNotesDraft(task.notes ?? "");
  }, [expanded, notesDirty, showInlineNotes, task.notes]);

  async function updateSteps(nextSteps: Task["steps"]) {
    if (!onUpdateTask) return;
    if (stepBusy) return;
    setStepBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      await onUpdateTask({ ...task, steps: nextSteps, updated_at: now });
    } finally {
      setStepBusy(false);
    }
  }

  async function handleAddStep() {
    const title = newStepTitle.trim();
    if (!title) return;
    if (!canEditSteps) return;
    const ts = Math.floor(Date.now() / 1000);
    const nextSteps = [
      ...task.steps,
      {
        id: crypto.randomUUID(),
        title,
        completed: false,
        created_at: ts,
      },
    ];
    setNewStepTitle("");
    await updateSteps(nextSteps);
  }

  async function handleToggleStep(stepId: string) {
    if (!canEditSteps) return;
    const ts = Math.floor(Date.now() / 1000);
    const nextSteps = task.steps.map((step) => {
      if (step.id !== stepId) return step;
      const completed = !step.completed;
      return {
        ...step,
        completed,
        completed_at: completed ? ts : undefined,
      };
    });
    await updateSteps(nextSteps);
  }

  async function handleRemoveStep(stepId: string) {
    if (!canEditSteps) return;
    await updateSteps(task.steps.filter((step) => step.id !== stepId));
  }

  async function handleSaveNotes() {
    if (!onUpdateTask) return;
    if (!canEditNotes) return;
    if (notesBusy) return;

    const current = (task.notes ?? "").trim();
    const next = notesDraft.trim();
    if (current === next) {
      setNotesDirty(false);
      return;
    }

    setNotesBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      await onUpdateTask({
        ...task,
        notes: next || undefined,
        updated_at: now,
      });
      setNotesDirty(false);
    } finally {
      setNotesBusy(false);
    }
  }

  return (
    <div
      className={`task-card ${mode} q${task.quadrant} ${task.completed ? "completed" : ""} ${overdue ? "overdue" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      ref={cardRef}
    >
      <div className={`task-row ${canSelect ? "selectable" : ""}`}>
        {canSelect && (
          <button
            type="button"
            className={`task-select ${selected ? "selected" : ""}`}
            onClick={() => onToggleSelected?.()}
            title={selected ? t("batch.unselect") : t("batch.select")}
            aria-label={selected ? t("batch.unselect") : t("batch.select")}
            aria-pressed={Boolean(selected)}
          >
            {selected && <Icons.Check />}
          </button>
        )}
        <button
          type="button"
          className="task-checkbox"
          onClick={onToggleComplete}
          title={
            task.completed ? t("task.markIncomplete") : t("task.markComplete")
          }
          aria-label={
            task.completed ? t("task.markIncomplete") : t("task.markComplete")
          }
          aria-pressed={task.completed}
        >
          {task.completed && <Icons.Check />}
        </button>

        <div className="task-content">
          <span className="task-title">{task.title}</span>
          <div className="task-meta">
            <span className="task-due-time">
              <Icons.Clock />
              {formatDue(task.due_at)}
            </span>
            {overdueFlag && (
              <span className="task-overdue-flag" title={overdueFlag}>
                {overdueFlag}
              </span>
            )}
            {task.important && (
              <span className="task-chip important">
                <Icons.Star />
              </span>
            )}
            {task.repeat.type !== "none" && (
              <span
                className="task-chip"
                title={formatRepeatRule(task.repeat, t)}
              >
                <Icons.Repeat />
              </span>
            )}
            {task.reminder.kind !== "none" && (
              <span
                className={`task-chip ${task.reminder.kind === "forced" ? "danger" : ""}`}
              >
                <Icons.Bell />
              </span>
            )}
          </div>
          {task.tags.length > 0 && (
            <div className="task-tags">
              {task.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="tag-chip small">
                  {tag}
                </span>
              ))}
              {task.tags.length > 2 && (
                <span className="tag-chip small more">
                  +{task.tags.length - 2}
                </span>
              )}
            </div>
          )}
          {!expanded && task.steps.length > 0 && (
            <div
              className="task-steps-preview"
              aria-label={t("taskEdit.section.steps")}
            >
              {task.steps.slice(0, 3).map((step) => (
                <div
                  key={step.id}
                  className={`task-step-preview ${step.completed ? "completed" : ""}`}
                >
                  <span
                    className="task-step-preview-checkbox"
                    aria-hidden="true"
                  >
                    {step.completed && <Icons.Check />}
                  </span>
                  <span className="task-step-preview-title">{step.title}</span>
                </div>
              ))}
              {task.steps.length > 3 && (
                <div className="task-step-preview more" aria-hidden="true">
                  ... (+{task.steps.length - 3})
                </div>
              )}
            </div>
          )}
        </div>

        <div className="task-icons">
          {showMove && (
            <>
              <IconButton
                className="task-icon-btn"
                onClick={onMoveUp}
                title={t("task.moveUp")}
                label={t("task.moveUp")}
              >
                <Icons.ArrowUp />
              </IconButton>
              <IconButton
                className="task-icon-btn"
                onClick={onMoveDown}
                title={t("task.moveDown")}
                label={t("task.moveDown")}
              >
                <Icons.ArrowDown />
              </IconButton>
            </>
          )}
          {onReschedulePreset && (
            <IconButton
              className={`task-icon-btn ${canReschedule ? "" : "disabled"}`}
              onClick={() => setRescheduleOpen((prev) => !prev)}
              title={t("task.reschedule")}
              label={t("task.reschedule")}
              aria-expanded={rescheduleOpen}
              disabled={!canReschedule}
            >
              <Icons.Snooze />
            </IconButton>
          )}
          <IconButton
            className={`task-icon-btn important ${task.important ? "active" : ""}`}
            onClick={onToggleImportant}
            title={
              task.important
                ? t("task.unmarkImportant")
                : t("task.markImportant")
            }
            label={
              task.important
                ? t("task.unmarkImportant")
                : t("task.markImportant")
            }
            aria-pressed={task.important}
          >
            <Icons.Star />
          </IconButton>
          <IconButton
            className="task-icon-btn"
            onClick={onDelete}
            title={t("common.delete")}
            label={t("task.delete")}
          >
            <Icons.Trash />
          </IconButton>
          <IconButton
            className="task-icon-btn"
            onClick={onEdit}
            title={t("common.edit")}
            label={t("task.edit")}
          >
            <Icons.Edit />
          </IconButton>
          <IconButton
            className="task-icon-btn"
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? t("task.collapse") : t("task.expand")}
            label={expanded ? t("task.collapse") : t("task.expand")}
            aria-expanded={expanded}
          >
            {expanded ? <Icons.ChevronDown /> : <Icons.ChevronRight />}
          </IconButton>
        </div>
      </div>

      {rescheduleOpen && onReschedulePreset && (
        <div
          className="task-reschedule-menu"
          role="group"
          aria-label={t("task.reschedule")}
        >
          <button
            type="button"
            className="pill"
            onClick={() => {
              onReschedulePreset("plus10m");
              setRescheduleOpen(false);
            }}
          >
            {t("reschedule.plus10m")}
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => {
              onReschedulePreset("plus1h");
              setRescheduleOpen(false);
            }}
          >
            {t("reschedule.plus1h")}
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => {
              onReschedulePreset("tomorrow1800");
              setRescheduleOpen(false);
            }}
          >
            {t("reschedule.tomorrow1800")}
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => {
              onReschedulePreset("nextWorkday0900");
              setRescheduleOpen(false);
            }}
          >
            {t("reschedule.nextWorkday0900")}
          </button>
        </div>
      )}

      {expanded && (
        <div className="task-details">
          <div className="steps-section">
            <div className="steps-header">
              <span>{t("taskEdit.section.steps")}</span>
            </div>

            {task.steps.map((step) => (
              <div
                key={step.id}
                className={`step-item ${step.completed ? "completed" : ""}`}
              >
                <button
                  type="button"
                  className="step-checkbox"
                  onClick={() => void handleToggleStep(step.id)}
                  aria-label={
                    step.completed
                      ? t("taskEdit.stepMarkIncomplete")
                      : t("taskEdit.stepMarkComplete")
                  }
                  aria-pressed={step.completed}
                  disabled={stepBusy || !canEditSteps}
                >
                  {step.completed && <Icons.Check />}
                </button>
                <span className="step-title">{step.title}</span>
                <button
                  type="button"
                  className="step-delete"
                  onClick={() => void handleRemoveStep(step.id)}
                  title={t("taskEdit.stepDelete")}
                  aria-label={t("taskEdit.stepDelete")}
                  disabled={stepBusy || !canEditSteps}
                >
                  <Icons.X />
                </button>
              </div>
            ))}

            {stepAddOpen ? (
              <div className="step-add-row">
                <input
                  ref={stepAddInputRef}
                  className="steps-input"
                  placeholder={t("taskEdit.stepPlaceholder")}
                  value={newStepTitle}
                  onChange={(event) =>
                    setNewStepTitle(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleAddStep();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setNewStepTitle("");
                      setStepAddOpen(false);
                    }
                  }}
                  disabled={stepBusy || !canEditSteps}
                />
                <button
                  type="button"
                  className="step-add-cancel"
                  onClick={() => {
                    setNewStepTitle("");
                    setStepAddOpen(false);
                  }}
                  title={t("common.close")}
                  aria-label={t("common.close")}
                  disabled={stepBusy}
                >
                  <Icons.X />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="step-add-bar"
                onClick={() => {
                  if (!canEditSteps || stepBusy) return;
                  setStepAddOpen(true);
                }}
                disabled={stepBusy || !canEditSteps}
                aria-label={t("taskEdit.stepAdd")}
                title={t("taskEdit.stepAdd")}
              >
                <Icons.Plus />
                <span>{t("taskEdit.stepAdd")}</span>
              </button>
            )}
          </div>

          {showInlineNotes && (
            <div className="notes-section">
              <div className="notes-header">{t("taskEdit.section.notes")}</div>
              <textarea
                className="notes-input inline-notes"
                value={notesDraft}
                placeholder={t("taskEdit.notesPlaceholder")}
                onChange={(event) => {
                  setNotesDirty(true);
                  setNotesDraft(event.currentTarget.value);
                }}
                onBlur={() => void handleSaveNotes()}
                disabled={!canEditNotes || notesBusy}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
