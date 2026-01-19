import { useEffect, useState } from "react";

import { formatDue, fromDateTimeLocal, toDateTimeLocal } from "../date";
import { buildReminderConfig, getReminderOffsetMinutes, REMINDER_KIND_OPTIONS, REMINDER_OFFSET_PRESETS } from "../reminder";
import { defaultRepeatRule, REPEAT_TYPE_OPTIONS, WEEKDAY_OPTIONS } from "../repeat";
import type { ReminderKind, RepeatRule, Task } from "../types";

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
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDueAt, setDraftDueAt] = useState(task.due_at);
  const [draftReminderKind, setDraftReminderKind] = useState<ReminderKind>(task.reminder.kind);
  const [draftReminderOffset, setDraftReminderOffset] = useState<number>(getReminderOffsetMinutes(task));
  const [draftRepeat, setDraftRepeat] = useState<RepeatRule>(task.repeat);
  const [draftNotes, setDraftNotes] = useState(task.notes ?? "");
  const [draftSteps, setDraftSteps] = useState(task.steps);
  const [newStepTitle, setNewStepTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftTitle(task.title);
    setDraftDueAt(task.due_at);
    setDraftReminderKind(task.reminder.kind);
    setDraftReminderOffset(getReminderOffsetMinutes(task));
    setDraftRepeat(task.repeat);
    setDraftNotes(task.notes ?? "");
    setDraftSteps(task.steps);
    setNewStepTitle("");
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
    <div className="task-modal-overlay" role="dialog" aria-modal="true" aria-label="编辑任务" onClick={onClose}>
      <div className="task-modal" onClick={(event) => event.stopPropagation()}>
        <div className="task-modal-header">
          <div className="task-modal-title">
            <span>编辑任务</span>
            <span className="task-modal-subtitle">{formatDue(task.due_at)}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭编辑" title="关闭">
            <Icons.X />
          </button>
        </div>

        <div className="task-modal-body">
          <div className="task-modal-row">
            <input
              className="task-edit-title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              placeholder="任务标题"
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
              重置
            </button>
            <div className="task-modal-actions-right">
              <button type="button" className="task-edit-btn ghost" onClick={onClose} disabled={saving}>
                取消
              </button>
              <button
                type="button"
                className="task-edit-btn"
                onClick={() => void handleSave()}
                disabled={saving || !draftTitle.trim()}
                title={!draftTitle.trim() ? "标题不能为空" : "保存"}
              >
                保存
              </button>
            </div>
          </div>

          <div className="inline-config">
            <div className="inline-config-group">
              <span className="inline-config-label">提醒</span>
              <div className="inline-config-buttons">
                {REMINDER_KIND_OPTIONS.map((opt) => (
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
                  <div className="inline-config-buttons" aria-label="提醒快捷时间">
                    {REMINDER_OFFSET_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`pill ${draftReminderOffset === preset.minutes ? "active" : ""}`}
                        onClick={() => setDraftReminderOffset(preset.minutes)}
                        aria-pressed={draftReminderOffset === preset.minutes}
                        disabled={saving}
                        title={preset.minutes === 0 ? "到期时提醒" : `提前 ${preset.label} 提醒`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="inline-config-extra">
                    <span>提前</span>
                    <input
                      type="number"
                      min={0}
                      className="inline-input"
                      value={draftReminderOffset}
                      onChange={(event) => setDraftReminderOffset(Number(event.currentTarget.value) || 0)}
                      disabled={saving}
                    />
                    <span>分钟</span>
                  </div>
                </>
              )}
            </div>

            <div className="inline-config-group">
              <span className="inline-config-label">循环</span>
              <div className="inline-config-buttons">
                {REPEAT_TYPE_OPTIONS.map((opt) => (
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
                    仅工作日
                  </button>
                </div>
              )}
              {draftRepeat.type === "weekly" && (
                <div className="inline-config-buttons">
                  {WEEKDAY_OPTIONS.map((day) => {
                    const selected = draftRepeat.days.includes(day.id);
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
                        周{day.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {draftRepeat.type === "monthly" && (
                <div className="inline-config-extra">
                  <span>每月</span>
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
                  <span>号</span>
                </div>
              )}
              {draftRepeat.type === "yearly" && (
                <div className="inline-config-extra">
                  <span>每年</span>
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
                  <span>月</span>
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
                  <span>号</span>
                </div>
              )}
            </div>
          </div>

          <div className="steps-section">
            <div className="steps-header">
              <span>步骤</span>
              <div className="steps-add">
                <input
                  className="steps-input"
                  placeholder="添加步骤"
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
                  title={!newStepTitle.trim() ? "请输入步骤内容" : "添加步骤"}
                  aria-label="添加步骤"
                >
                  <Icons.Plus />
                </button>
              </div>
            </div>
            {draftSteps.length === 0 ? (
              <div className="steps-empty">无步骤</div>
            ) : (
              draftSteps.map((step) => (
                <div key={step.id} className={`step-item ${step.completed ? "completed" : ""}`}>
                  <button
                    type="button"
                    className="step-checkbox"
                    onClick={() => toggleStep(step.id)}
                    aria-label={step.completed ? "标记步骤为未完成" : "标记步骤为完成"}
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
                    title="删除步骤"
                    aria-label="删除步骤"
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
              <div className="notes-header">备注</div>
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
