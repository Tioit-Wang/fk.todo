import { useEffect, useMemo, useRef, useState } from "react";

import { Icons } from "./icons";

import { formatDue, fromDateTimeLocal, toDateTimeLocal } from "../date";
import { defaultDueAt } from "../scheduler";
import type { ReminderKind, RepeatRule } from "../types";

const QUICK_DUE_PRESETS = [
  { id: "today", label: "今天 18:00", offsetDays: 0 },
  { id: "tomorrow", label: "明天 18:00", offsetDays: 1 },
  { id: "dayAfter", label: "后天 18:00", offsetDays: 2 },
] as const;

const REMINDER_KIND_OPTIONS = [
  { id: "none", label: "不提醒" },
  { id: "normal", label: "普通" },
  { id: "forced", label: "强制" },
] as const;

const REPEAT_TYPE_OPTIONS = [
  { id: "none", label: "不循环" },
  { id: "daily", label: "每日" },
  { id: "weekly", label: "每周" },
  { id: "monthly", label: "每月" },
  { id: "yearly", label: "每年" },
] as const;

const WEEKDAY_OPTIONS = [
  { id: 1, label: "一" },
  { id: 2, label: "二" },
  { id: 3, label: "三" },
  { id: 4, label: "四" },
  { id: 5, label: "五" },
  { id: 6, label: "六" },
  { id: 7, label: "日" },
] as const;

function defaultRepeatRule(type: RepeatRule["type"]): RepeatRule {
  const now = new Date();
  switch (type) {
    case "daily":
      return { type: "daily", workday_only: false };
    case "weekly":
      return { type: "weekly", days: [1, 2, 3, 4, 5] };
    case "monthly":
      return { type: "monthly", day: Math.min(31, Math.max(1, now.getDate())) };
    case "yearly":
      return { type: "yearly", month: now.getMonth() + 1, day: now.getDate() };
    case "none":
    default:
      return { type: "none" };
  }
}

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

  const [dueAt, setDueAt] = useState<number>(() => defaultDueAt(new Date()));
  const [important, setImportant] = useState(false);
  const [repeat, setRepeat] = useState<RepeatRule>({ type: "none" });
  const [reminderKind, setReminderKind] = useState<ReminderKind>("none");
  const [reminderOffset, setReminderOffset] = useState<number>(10);

  const initialDueAtRef = useRef<number>(dueAt);

  const dueTimePreview = useMemo(() => formatDue(dueAt), [dueAt]);

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
                {QUICK_DUE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="pill"
                    onClick={() => {
                      const base = new Date();
                      const target = new Date(base);
                      target.setDate(target.getDate() + preset.offsetDays);
                      target.setHours(18, 0, 0, 0);
                      setDueAt(Math.floor(target.getTime() / 1000));
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
                <button type="button" className="pill" onClick={() => setDueAt(quickDueSunday)}>
                  本周日 18:00
                </button>
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

      <div className="composer-footer">
        <div className="composer-due-preview">
          <Icons.Clock />
          <span>{dueTimePreview}</span>
        </div>

        <button
          type="button"
          className="composer-submit"
          onClick={() => void handleSubmit()}
          disabled={!title.trim()}
          title={!title.trim() ? "请输入任务内容" : "添加任务"}
        >
          添加
        </button>
      </div>
    </div>
  );
}
