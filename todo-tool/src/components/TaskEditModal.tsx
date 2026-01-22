import { useEffect, useMemo, useState } from "react";

import { formatDue, fromDateTimeLocal, toDateTimeLocal } from "../date";
import { useI18n } from "../i18n";
import { buildReminderConfig, getReminderOffsetMinutes, buildReminderKindOptions, buildReminderOffsetPresets } from "../reminder";
import { defaultRepeatRule, buildRepeatTypeOptions, buildWeekdayOptions } from "../repeat";
import { normalizeTag } from "../tags";
import type { ReminderKind, RepeatRule, Task } from "../types";

import { IconButton } from "./IconButton";
import { Icons } from "./icons";

// Edit modal for an existing task. This stays as a controlled component (props in, callbacks out)
// so App can keep the single source of truth for tasks/settings.
export function TaskEditModal({
  task,
  showNotes,
  onSave,
  onClose,
}: {
  task: Task;
  showNotes: boolean;
  onSave: (next: Task) => Promise<void> | void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDueAt, setDraftDueAt] = useState(task.due_at);
  const [draftReminderKind, setDraftReminderKind] = useState<ReminderKind>(task.reminder.kind);
  const [draftReminderOffset, setDraftReminderOffset] = useState<number>(getReminderOffsetMinutes(task));
  const [draftRepeat, setDraftRepeat] = useState<RepeatRule>(task.repeat);
  const [draftNotes, setDraftNotes] = useState(task.notes ?? "");
  const [draftSteps, setDraftSteps] = useState(task.steps);
  const [draftTags, setDraftTags] = useState<string[]>(task.tags);
  const [newStepTitle, setNewStepTitle] = useState("");
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);

  const reminderKindOptions = useMemo(() => buildReminderKindOptions(t), [t]);
  const reminderOffsetPresets = useMemo(() => buildReminderOffsetPresets(t), [t]);
  const repeatTypeOptions = useMemo(() => buildRepeatTypeOptions(t), [t]);
  const weekdayOptions = useMemo(() => buildWeekdayOptions(t), [t]);

  useEffect(() => {
    setDraftTitle(task.title);
    setDraftDueAt(task.due_at);
    setDraftReminderKind(task.reminder.kind);
    setDraftReminderOffset(getReminderOffsetMinutes(task));
    setDraftRepeat(task.repeat);
    setDraftNotes(task.notes ?? "");
    setDraftSteps(task.steps);
    setDraftTags(task.tags);
    setNewStepTitle("");
    setNewTag("");
    setSaving(false);
  }, [task.id]);

  function handleReset() {
    setDraftTitle(task.title);
    setDraftDueAt(task.due_at);
    setDraftReminderKind(task.reminder.kind);
    setDraftReminderOffset(getReminderOffsetMinutes(task));
    setDraftRepeat(task.repeat);
    setDraftNotes(task.notes ?? "");
    setDraftSteps(task.steps);
    setNewStepTitle("");
    setDraftTags(task.tags);
    setNewTag("");
  }

  function handleAddTag(value?: string) {
    const tag = normalizeTag(value ?? newTag);
    if (!tag) return;
    setDraftTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    setNewTag("");
  }

  function handleRemoveTag(tag: string) {
    setDraftTags((prev) => prev.filter((item) => item !== tag));
  }

  function handleAddStep() {
    const title = newStepTitle.trim();
    if (!title) return;
    const ts = Math.floor(Date.now() / 1000);
    setDraftSteps((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title,
        completed: false,
        created_at: ts,
      },
    ]);
    setNewStepTitle("");
  }

  function toggleStep(stepId: string) {
    const ts = Math.floor(Date.now() / 1000);
    setDraftSteps((prev) =>
      prev.map((step) => {
        if (step.id !== stepId) return step;
        const completed = !step.completed;
        return {
          ...step,
          completed,
          completed_at: completed ? ts : undefined,
        };
      }),
    );
  }

  function removeStep(stepId: string) {
    setDraftSteps((prev) => prev.filter((step) => step.id !== stepId));
  }

  async function handleSave() {
    const title = draftTitle.trim();
    if (!title) return;
    const now = Math.floor(Date.now() / 1000);
    const next: Task = {
      ...task,
      title,
      due_at: draftDueAt,
      repeat: draftRepeat,
      reminder: buildReminderConfig(draftReminderKind, draftDueAt, draftReminderOffset),
      steps: draftSteps,
      tags: draftTags,
      notes: showNotes ? draftNotes.trim() || undefined : task.notes,
      updated_at: now,
    };
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="task-modal-overlay" role="dialog" aria-modal="true" aria-label={t("taskEdit.title")} onClick={onClose}>
      <div className="task-modal" onClick={(event) => event.stopPropagation()}>
        <div className="task-modal-header">
          <div className="task-modal-title">
            <span>{t("taskEdit.title")}</span>
            <span className="task-modal-subtitle">{formatDue(task.due_at)}</span>
          </div>
          <IconButton className="icon-btn" onClick={onClose} label={t("taskEdit.close")} title={t("common.close")}>
            <Icons.X />
          </IconButton>
        </div>

        <div className="task-modal-body">
          <div className="task-modal-row">
            <input
              className="task-edit-title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              placeholder={t("taskEdit.titlePlaceholder")}
            />
            <input
              className="task-edit-due"
              type="datetime-local"
              value={toDateTimeLocal(draftDueAt)}
              onChange={(event) => {
                const next = fromDateTimeLocal(event.currentTarget.value);
                if (next) setDraftDueAt(next);
              }}
            />
          </div>

          <div className="task-modal-actions">
            <button type="button" className="task-edit-btn ghost" onClick={handleReset} disabled={saving}>
              {t("common.reset")}
            </button>
            <div className="task-modal-actions-right">
              <button type="button" className="task-edit-btn ghost" onClick={onClose} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="task-edit-btn"
                onClick={() => void handleSave()}
                disabled={saving || !draftTitle.trim()}
                title={!draftTitle.trim() ? t("taskEdit.validation.titleRequired") : t("common.save")}
              >
                {t("common.save")}
              </button>
            </div>
          </div>

          <div className="inline-config">
            <div className="inline-config-group">
              <span className="inline-config-label">{t("taskEdit.section.reminder")}</span>
              <div className="inline-config-buttons">
                {reminderKindOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`pill ${draftReminderKind === opt.id ? "active" : ""}`}
                    onClick={() => {
                      setDraftReminderKind(opt.id);
                      setDraftReminderOffset(opt.id === "normal" ? 10 : 0);
                    }}
                    aria-pressed={draftReminderKind === opt.id}
                    disabled={saving}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {draftReminderKind !== "none" && (
                <>
                  <div className="inline-config-buttons" aria-label={t("taskEdit.section.reminder")}>
                    {reminderOffsetPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`pill ${draftReminderOffset === preset.minutes ? "active" : ""}`}
                        onClick={() => setDraftReminderOffset(preset.minutes)}
                        aria-pressed={draftReminderOffset === preset.minutes}
                        disabled={saving}
                        title={
                          preset.minutes === 0
                            ? t("reminder.offset.titleAtDue")
                            : t("reminder.offset.titleBefore", { label: preset.label })
                        }
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="inline-config-extra">
                    <span>{t("reminder.offset.before")}</span>
                    <input
                      type="number"
                      min={0}
                      className="inline-input"
                      value={draftReminderOffset}
                      onChange={(event) => setDraftReminderOffset(Number(event.currentTarget.value) || 0)}
                      disabled={saving}
                    />
                    <span>{t("reminder.offset.minutes")}</span>
                  </div>
                </>
              )}
            </div>

            <div className="inline-config-group">
              <span className="inline-config-label">{t("taskEdit.section.repeat")}</span>
              <div className="inline-config-buttons">
                {repeatTypeOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`pill ${draftRepeat.type === opt.id ? "active" : ""}`}
                    onClick={() => setDraftRepeat(defaultRepeatRule(opt.id))}
                    aria-pressed={draftRepeat.type === opt.id}
                    disabled={saving}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {draftRepeat.type === "daily" && (
                <div className="inline-config-extra">
                  <button
                    type="button"
                    className={`pill ${draftRepeat.workday_only ? "active" : ""}`}
                    onClick={() =>
                      setDraftRepeat({
                        type: "daily",
                        workday_only: !draftRepeat.workday_only,
                      })
                    }
                    aria-pressed={draftRepeat.workday_only}
                    disabled={saving}
                  >
                    {t("repeat.workdayOnly")}
                  </button>
                </div>
              )}
              {draftRepeat.type === "weekly" && (
                <div className="inline-config-buttons">
                  {weekdayOptions.map((day) => {
                    const selected = draftRepeat.days.includes(day.id);
                    const prefix = t("repeat.weekdayPrefix");
                    return (
                      <button
                        key={day.id}
                        type="button"
                        className={`pill ${selected ? "active" : ""}`}
                        onClick={() => {
                          const nextDays = selected
                            ? draftRepeat.days.filter((value) => value !== day.id)
                            : [...draftRepeat.days, day.id];
                          if (nextDays.length === 0) return;
                          setDraftRepeat({ type: "weekly", days: nextDays.sort() });
                        }}
                        aria-pressed={selected}
                        disabled={saving}
                      >
                        {prefix ? `${prefix}${day.label}` : day.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {draftRepeat.type === "monthly" && (
                <div className="inline-config-extra">
                  <span>{t("repeat.monthly")}</span>
                  <input
                    className="inline-input"
                    type="number"
                    min={1}
                    max={31}
                    value={draftRepeat.day}
                    onChange={(event) =>
                      setDraftRepeat({
                        type: "monthly",
                        day: Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)),
                      })
                    }
                    disabled={saving}
                  />
                  <span>{t("repeat.dayUnit")}</span>
                </div>
              )}
              {draftRepeat.type === "yearly" && (
                <div className="inline-config-extra">
                  <span>{t("repeat.yearly")}</span>
                  <input
                    className="inline-input"
                    type="number"
                    min={1}
                    max={12}
                    value={draftRepeat.month}
                    onChange={(event) =>
                      setDraftRepeat({
                        type: "yearly",
                        month: Math.min(12, Math.max(1, Number(event.currentTarget.value) || 1)),
                        day: draftRepeat.day,
                      })
                    }
                    disabled={saving}
                  />
                  <span>{t("repeat.monthUnit")}</span>
                  <input
                    className="inline-input"
                    type="number"
                    min={1}
                    max={31}
                    value={draftRepeat.day}
                    onChange={(event) =>
                      setDraftRepeat({
                        type: "yearly",
                        month: draftRepeat.month,
                        day: Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)),
                      })
                    }
                    disabled={saving}
                  />
                  <span>{t("repeat.dayUnit")}</span>
                </div>
              )}
            </div>
          </div>

          <div className="tags-section">
            <div className="tags-header">
              <span>{t("taskEdit.section.tags")}</span>
              <div className="tags-add">
                <input
                  className="tags-input"
                  placeholder={t("taskEdit.tagPlaceholder")}
                  value={newTag}
                  onChange={(event) => setNewTag(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAddTag();
                  }}
                  disabled={saving}
                />
                <button
                  type="button"
                  className="tag-add-btn"
                  onClick={() => handleAddTag()}
                  disabled={saving || !newTag.trim()}
                  title={!newTag.trim() ? t("taskEdit.tagRequired") : t("taskEdit.tagAdd")}
                  aria-label={t("taskEdit.tagAdd")}
                >
                  <Icons.Plus />
                </button>
              </div>
            </div>

            {draftTags.length === 0 ? (
              <div className="tags-empty">{t("taskEdit.tagEmpty")}</div>
            ) : (
              <div className="tags-list">
                {draftTags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    <span className="tag-text">{tag}</span>
                    <button
                      type="button"
                      className="tag-delete"
                      onClick={() => handleRemoveTag(tag)}
                      title={t("taskEdit.tagDelete")}
                      aria-label={t("taskEdit.tagDelete")}
                      disabled={saving}
                    >
                      <Icons.X />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="steps-section">
            <div className="steps-header">
              <span>{t("taskEdit.section.steps")}</span>
              <div className="steps-add">
                <input
                  className="steps-input"
                  placeholder={t("taskEdit.stepPlaceholder")}
                  value={newStepTitle}
                  onChange={(event) => setNewStepTitle(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAddStep();
                  }}
                  disabled={saving}
                />
                <button
                  type="button"
                  className="step-add-btn"
                  onClick={handleAddStep}
                  disabled={saving || !newStepTitle.trim()}
                  title={!newStepTitle.trim() ? t("taskEdit.stepRequired") : t("taskEdit.stepAdd")}
                  aria-label={t("taskEdit.stepAdd")}
                >
                  <Icons.Plus />
                </button>
              </div>
            </div>
            {draftSteps.length === 0 ? (
              <div className="steps-empty">{t("taskEdit.stepEmpty")}</div>
            ) : (
              draftSteps.map((step) => (
                <div key={step.id} className={`step-item ${step.completed ? "completed" : ""}`}>
                  <button
                    type="button"
                    className="step-checkbox"
                    onClick={() => toggleStep(step.id)}
                    aria-label={step.completed ? t("taskEdit.stepMarkIncomplete") : t("taskEdit.stepMarkComplete")}
                    aria-pressed={step.completed}
                    disabled={saving}
                  >
                    {step.completed && <Icons.Check />}
                  </button>
                  <span className="step-title">{step.title}</span>
                  <button
                    type="button"
                    className="step-delete"
                    onClick={() => removeStep(step.id)}
                    title={t("taskEdit.stepDelete")}
                    aria-label={t("taskEdit.stepDelete")}
                    disabled={saving}
                  >
                    <Icons.X />
                  </button>
                </div>
              ))
            )}
          </div>

          {showNotes && (
            <div className="notes-section">
              <div className="notes-header">{t("taskEdit.section.notes")}</div>
              <textarea
                className="notes-input"
                rows={4}
                value={draftNotes}
                onChange={(event) => setDraftNotes(event.currentTarget.value)}
                disabled={saving}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
