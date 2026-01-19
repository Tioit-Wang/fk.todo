import { useEffect, useMemo, useRef, useState } from "react";

import { Icons } from "./icons";

import { fromDateTimeLocal, toDateTimeLocal } from "../date";
import { REMINDER_KIND_OPTIONS, REMINDER_OFFSET_PRESETS } from "../reminder";
import { defaultDueAt } from "../scheduler";
import { defaultRepeatRule, REPEAT_TYPE_OPTIONS, WEEKDAY_OPTIONS } from "../repeat";
import type { ReminderKind, RepeatRule } from "../types";

const QUICK_DUE_PRESETS = [
  { id: "today", label: "今天 18:00", offsetDays: 0 },
  { id: "tomorrow", label: "明天 18:00", offsetDays: 1 },
  { id: "dayAfter", label: "后天 18:00", offsetDays: 2 },
] as const;

// Relative shortcuts are handy for short-lived tasks (e.g. "call back in 30m").
const QUICK_DUE_RELATIVE_PRESETS = [
  { id: "30m", label: "半小时后", minutes: 30 },
  { id: "1h", label: "1小时后", minutes: 60 },
  { id: "2h", label: "2小时后", minutes: 120 },
  { id: "4h", label: "4小时后", minutes: 240 },
] as const;

export type TaskComposerDraft = {
  title: string;
  due_at: number;
  important: boolean;
  repeat: RepeatRule;
  reminder_kind: ReminderKind;
  reminder_offset_minutes: number;
};

export function TaskComposer({
  placeholder = "输入任务内容，回车添加",
  onSubmit,
}: {
  placeholder?: string;
  onSubmit: (draft: TaskComposerDraft) => Promise<void> | void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [title, setTitle] = useState("");
  const [activePopup, setActivePopup] = useState<"due" | "reminder" | "repeat" | null>(null);

  // Used for disabling "past" presets (e.g. selecting "today 18:00" after 18:00).
  // This is evaluated on each render; opening the popup triggers a render, so it's current enough for UI gating.
  const nowForPresets = new Date();

  const [dueAt, setDueAt] = useState<number>(() => defaultDueAt(new Date()));
  const [important, setImportant] = useState(false);
  const [repeat, setRepeat] = useState<RepeatRule>({ type: "none" });
  const [reminderKind, setReminderKind] = useState<ReminderKind>("none");
  const [reminderOffset, setReminderOffset] = useState<number>(10);

  const initialDueAtRef = useRef<number>(dueAt);

  const quickDueSunday = useMemo(() => {
    const now = new Date();
    const target = new Date(now);
    const day = target.getDay();
    const diff = (7 - day) % 7;
    target.setDate(target.getDate() + diff);
    target.setHours(18, 0, 0, 0);
    if (diff === 0 && now.getTime() > target.getTime()) {
      target.setDate(target.getDate() + 7);
    }
    return Math.floor(target.getTime() / 1000);
  }, []);

  const isDueCustomized = dueAt !== initialDueAtRef.current;
  const isReminderActive = reminderKind !== "none";
  const isRepeatActive = repeat.type !== "none";

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!activePopup) return;
      const target = event.target as Node | null;
      if (!target) return;
      const wrapper = wrapperRef.current;
      if (wrapper && !wrapper.contains(target)) {
        setActivePopup(null);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!activePopup) return;
      if (event.key === "Escape") setActivePopup(null);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activePopup]);

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    await onSubmit({
      title: trimmed,
      due_at: dueAt,
      important,
      repeat,
      reminder_kind: reminderKind,
      reminder_offset_minutes: reminderOffset,
    });
    setTitle("");
    setRepeat({ type: "none" });
    setImportant(false);
    setReminderKind("none");
    setReminderOffset(10);
    const nextDefault = defaultDueAt(new Date());
    initialDueAtRef.current = nextDefault;
    setDueAt(nextDefault);
    setActivePopup(null);
  }

  function togglePopup(next: typeof activePopup) {
    setActivePopup((prev) => (prev === next ? null : next));
  }

  return (
    <div className="composer-bar" ref={wrapperRef}>
      <div className="composer-input-wrapper">
        <input
          type="text"
          className="composer-input"
          placeholder={placeholder}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit();
          }}
        />

        <div className="composer-actions" aria-label="Task options">
          <button
            type="button"
            className={`composer-action-btn ${activePopup === "due" || isDueCustomized ? "active" : ""}`}
            onClick={() => togglePopup("due")}
            title="到期时间"
            aria-label="到期时间"
            aria-expanded={activePopup === "due"}
          >
            <Icons.Calendar />
          </button>
          <button
            type="button"
            className={`composer-action-btn ${activePopup === "reminder" || isReminderActive ? "active" : ""}`}
            onClick={() => togglePopup("reminder")}
            title="提醒"
            aria-label="提醒"
            aria-expanded={activePopup === "reminder"}
          >
            <Icons.Bell />
          </button>
          <button
            type="button"
            className={`composer-action-btn ${activePopup === "repeat" || isRepeatActive ? "active" : ""}`}
            onClick={() => togglePopup("repeat")}
            title="循环"
            aria-label="循环"
            aria-expanded={activePopup === "repeat"}
          >
            <Icons.Repeat />
          </button>
          <button
            type="button"
            className={`composer-action-btn ${important ? "active" : ""}`}
            onClick={() => setImportant((prev) => !prev)}
            title={important ? "取消重要" : "标记重要"}
            aria-label={important ? "取消标记重要" : "标记为重要"}
            aria-pressed={important}
          >
            <Icons.Star />
          </button>
        </div>

        {activePopup === "due" && (
          <div className="composer-popup" role="dialog" aria-label="到期时间设置">
            <div className="composer-popup-section">
              <div className="composer-popup-title">到期时间</div>
              <div className="composer-popup-row">
                {QUICK_DUE_PRESETS.map((preset) => {
                  const target = new Date(nowForPresets);
                  target.setDate(target.getDate() + preset.offsetDays);
                  target.setHours(18, 0, 0, 0);

                  // If it's already past 18:00 today, "today 18:00" becomes an invalid shortcut.
                  const disabled = preset.offsetDays === 0 && nowForPresets.getTime() > target.getTime();

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="pill"
                      disabled={disabled}
                      title={disabled ? "当前时间已超过 18:00" : undefined}
                      onClick={() => {
                        if (disabled) return;
                        setDueAt(Math.floor(target.getTime() / 1000));
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <button type="button" className="pill" onClick={() => setDueAt(quickDueSunday)}>
                  本周日 18:00
                </button>
              </div>

              <div className="composer-popup-title">相对时间</div>
              <div className="composer-popup-row">
                {QUICK_DUE_RELATIVE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="pill"
                    onClick={() => {
                      const now = new Date();
                      now.setSeconds(0, 0);
                      now.setMinutes(now.getMinutes() + preset.minutes);
                      setDueAt(Math.floor(now.getTime() / 1000));
                    }}
                    title={`从现在起 ${preset.label}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="datetime-local"
                className="composer-popup-input"
                value={toDateTimeLocal(dueAt)}
                onChange={(event) => {
                  const next = fromDateTimeLocal(event.currentTarget.value);
                  if (next) setDueAt(next);
                }}
              />
            </div>
          </div>
        )}

        {activePopup === "reminder" && (
          <div className="composer-popup" role="dialog" aria-label="提醒设置">
            <div className="composer-popup-section">
              <div className="composer-popup-title">提醒</div>
              <div className="composer-popup-row">
                {REMINDER_KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`pill ${reminderKind === opt.id ? "active" : ""}`}
                    onClick={() => {
                      setReminderKind(opt.id);
                      setReminderOffset(opt.id === "normal" ? 10 : 0);
                    }}
                    aria-pressed={reminderKind === opt.id}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {reminderKind !== "none" && (
                <div className="composer-popup-row" aria-label="提醒快捷时间">
                  {REMINDER_OFFSET_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`pill ${reminderOffset === preset.minutes ? "active" : ""}`}
                      onClick={() => setReminderOffset(preset.minutes)}
                      aria-pressed={reminderOffset === preset.minutes}
                      title={preset.minutes === 0 ? "到期时提醒" : `提前 ${preset.label} 提醒`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
              {reminderKind !== "none" && (
                <div className="composer-popup-inline">
                  <span>提前</span>
                  <input
                    type="number"
                    min={0}
                    className="composer-popup-number"
                    value={reminderOffset}
                    onChange={(event) => setReminderOffset(Number(event.currentTarget.value) || 0)}
                  />
                  <span>分钟</span>
                </div>
              )}
            </div>
          </div>
        )}

        {activePopup === "repeat" && (
          <div className="composer-popup" role="dialog" aria-label="循环设置">
            <div className="composer-popup-section">
              <div className="composer-popup-title">循环</div>
              <div className="composer-popup-row">
                {REPEAT_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`pill ${repeat.type === opt.id ? "active" : ""}`}
                    onClick={() => setRepeat(defaultRepeatRule(opt.id))}
                    aria-pressed={repeat.type === opt.id}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {repeat.type === "daily" && (
                <div className="composer-popup-inline">
                  <button
                    type="button"
                    className={`pill ${repeat.workday_only ? "active" : ""}`}
                    onClick={() =>
                      setRepeat({
                        type: "daily",
                        workday_only: !repeat.workday_only,
                      })
                    }
                    aria-pressed={repeat.workday_only}
                  >
                    仅工作日
                  </button>
                </div>
              )}

              {repeat.type === "weekly" && (
                <div className="composer-popup-row">
                  {WEEKDAY_OPTIONS.map((day) => {
                    const selected = repeat.days.includes(day.id);
                    return (
                      <button
                        key={day.id}
                        type="button"
                        className={`pill ${selected ? "active" : ""}`}
                        onClick={() => {
                          const nextDays = selected
                            ? repeat.days.filter((value) => value !== day.id)
                            : [...repeat.days, day.id];
                          if (nextDays.length === 0) return;
                          setRepeat({ type: "weekly", days: nextDays.sort() });
                        }}
                        aria-pressed={selected}
                      >
                        周{day.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {repeat.type === "monthly" && (
                <div className="composer-popup-inline">
                  <span>每月</span>
                  <input
                    className="composer-popup-number"
                    type="number"
                    min={1}
                    max={31}
                    value={repeat.day}
                    onChange={(event) =>
                      setRepeat({
                        type: "monthly",
                        day: Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)),
                      })
                    }
                  />
                  <span>号</span>
                </div>
              )}

              {repeat.type === "yearly" && (
                <div className="composer-popup-inline">
                  <span>每年</span>
                  <input
                    className="composer-popup-number"
                    type="number"
                    min={1}
                    max={12}
                    value={repeat.month}
                    onChange={(event) =>
                      setRepeat({
                        type: "yearly",
                        month: Math.min(12, Math.max(1, Number(event.currentTarget.value) || 1)),
                        day: repeat.day,
                      })
                    }
                  />
                  <span>月</span>
                  <input
                    className="composer-popup-number"
                    type="number"
                    min={1}
                    max={31}
                    value={repeat.day}
                    onChange={(event) =>
                      setRepeat({
                        type: "yearly",
                        month: repeat.month,
                        day: Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)),
                      })
                    }
                  />
                  <span>号</span>
                </div>
              )}
            </div>
          </div>
      )}
      </div>
    </div>
  );
}
