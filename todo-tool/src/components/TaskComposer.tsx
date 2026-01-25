import { useEffect, useMemo, useRef, useState } from "react";

import { IconButton } from "./IconButton";
import { Icons } from "./icons";

import { fromDateTimeLocal, toDateTimeLocal } from "../date";
import { useI18n } from "../i18n";
import {
  buildReminderKindOptions,
  buildReminderOffsetPresets,
} from "../reminder";
import { defaultDueAt } from "../scheduler";
import {
  defaultRepeatRule,
  buildRepeatTypeOptions,
  buildWeekdayOptions,
} from "../repeat";
import { extractTagsFromTitle } from "../tags";
import type { ReminderKind, RepeatRule } from "../types";

export type TaskComposerDraft = {
  title: string;
  project_id: string;
  tags: string[];
  due_at: number;
  important: boolean;
  repeat: RepeatRule;
  reminder_kind: ReminderKind;
  reminder_offset_minutes: number;
};

export function TaskComposer({
  placeholder,
  projectId,
  onSubmit,
}: {
  placeholder?: string;
  projectId?: string;
  onSubmit: (
    draft: TaskComposerDraft,
  ) => Promise<boolean | void> | boolean | void;
}) {
  const { t } = useI18n();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const pendingSubmitRef = useRef(false);
  const composingRef = useRef(false);
  const [title, setTitle] = useState("");
  const [activePopup, setActivePopup] = useState<
    "due" | "reminder" | "repeat" | null
  >(null);

  // Used for disabling "past" presets (e.g. selecting "today 18:00" after 18:00).
  // This is evaluated on each render; opening the popup triggers a render, so it's current enough for UI gating.
  const nowForPresets = new Date();

  const [dueAt, setDueAt] = useState<number>(() => defaultDueAt(new Date()));
  const [important, setImportant] = useState(false);
  const [repeat, setRepeat] = useState<RepeatRule>({ type: "none" });
  const [reminderKind, setReminderKind] = useState<ReminderKind>("none");
  const [reminderOffset, setReminderOffset] = useState<number>(10);

  const initialDueAtRef = useRef<number>(dueAt);
  const placeholderText = placeholder ?? t("composer.placeholder");

  const quickDuePresets = useMemo(
    () => [
      { id: "today", label: t("composer.preset.today"), offsetDays: 0 },
      { id: "tomorrow", label: t("composer.preset.tomorrow"), offsetDays: 1 },
      { id: "dayAfter", label: t("composer.preset.dayAfter"), offsetDays: 2 },
    ],
    [t],
  );

  // Relative shortcuts are handy for short-lived tasks (e.g. "call back in 30m").
  const quickDueRelativePresets = useMemo(
    () => [
      { id: "30m", label: t("composer.preset.30m"), minutes: 30 },
      { id: "1h", label: t("composer.preset.1h"), minutes: 60 },
      { id: "2h", label: t("composer.preset.2h"), minutes: 120 },
      { id: "4h", label: t("composer.preset.4h"), minutes: 240 },
    ],
    [t],
  );

  const reminderKindOptions = useMemo(() => buildReminderKindOptions(t), [t]);
  const reminderOffsetPresets = useMemo(
    () => buildReminderOffsetPresets(t),
    [t],
  );
  const repeatTypeOptions = useMemo(() => buildRepeatTypeOptions(t), [t]);
  const weekdayOptions = useMemo(() => buildWeekdayOptions(t), [t]);

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
      if (event.key === "Escape") {
        event.preventDefault();
        setActivePopup(null);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activePopup]);

  async function handleSubmit(rawTitle?: string) {
    const sourceTitle = rawTitle ?? title;
    const { title: parsedTitle, tags } = extractTagsFromTitle(sourceTitle);
    if (!parsedTitle) return;
    try {
      const result = await onSubmit({
        title: parsedTitle,
        project_id: projectId ?? "inbox",
        tags,
        due_at: dueAt,
        important,
        repeat,
        reminder_kind: reminderKind,
        reminder_offset_minutes: reminderOffset,
      });
      if (result === false) return;
      setTitle("");
      setRepeat({ type: "none" });
      setImportant(false);
      setReminderKind("none");
      setReminderOffset(10);
      const nextDefault = defaultDueAt(new Date());
      initialDueAtRef.current = nextDefault;
      setDueAt(nextDefault);
      setActivePopup(null);
    } catch {
      // Keep the draft intact when the caller fails (e.g. invoke error).
    }
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
          placeholder={placeholderText}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // IME: don't submit while the user is still composing text.
            // We prefer tracking composition events ourselves because `isComposing` is not
            // consistently reported across platforms/WebView runtimes.
            if (composingRef.current || e.nativeEvent.keyCode === 229) {
              pendingSubmitRef.current = true;
              return;
            }
            e.preventDefault();
            void handleSubmit(e.currentTarget.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            if (!pendingSubmitRef.current) return;
            pendingSubmitRef.current = false;
            const value = event.currentTarget.value;
            window.requestAnimationFrame(() => {
              void handleSubmit(value);
            });
          }}
        />

        <div className="composer-actions" aria-label={t("composer.options")}>
          <IconButton
            className={`composer-action-btn ${activePopup === "due" || isDueCustomized ? "active" : ""}`}
            onClick={() => togglePopup("due")}
            title={t("composer.due")}
            label={t("composer.due")}
            aria-expanded={activePopup === "due"}
          >
            <Icons.Calendar />
          </IconButton>
          <IconButton
            className={`composer-action-btn ${activePopup === "reminder" || isReminderActive ? "active" : ""}`}
            onClick={() => togglePopup("reminder")}
            title={t("composer.reminder")}
            label={t("composer.reminder")}
            aria-expanded={activePopup === "reminder"}
          >
            <Icons.Bell />
          </IconButton>
          <IconButton
            className={`composer-action-btn ${activePopup === "repeat" || isRepeatActive ? "active" : ""}`}
            onClick={() => togglePopup("repeat")}
            title={t("composer.repeat")}
            label={t("composer.repeat")}
            aria-expanded={activePopup === "repeat"}
          >
            <Icons.Repeat />
          </IconButton>
          <IconButton
            className={`composer-action-btn ${important ? "active" : ""}`}
            onClick={() => setImportant((prev) => !prev)}
            title={
              important ? t("task.unmarkImportant") : t("task.markImportant")
            }
            label={
              important ? t("task.unmarkImportant") : t("task.markImportant")
            }
            aria-pressed={important}
          >
            <Icons.Star />
          </IconButton>
        </div>

        {activePopup === "due" && (
          <div
            className="composer-popup"
            role="dialog"
            aria-label={t("composer.popup.due")}
          >
            <div className="composer-popup-section">
              <div className="composer-popup-title">
                {t("composer.title.due")}
              </div>
              <div className="composer-popup-row">
                {quickDuePresets.map((preset) => {
                  const target = new Date(nowForPresets);
                  target.setDate(target.getDate() + preset.offsetDays);
                  target.setHours(18, 0, 0, 0);

                  // If it's already past 18:00 today, "today 18:00" becomes an invalid shortcut.
                  const disabled =
                    preset.offsetDays === 0 &&
                    nowForPresets.getTime() > target.getTime();

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="pill"
                      disabled={disabled}
                      title={
                        disabled
                          ? t("composer.preset.todayDisabled")
                          : undefined
                      }
                      onClick={() => {
                        if (disabled) return;
                        setDueAt(Math.floor(target.getTime() / 1000));
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="pill"
                  onClick={() => setDueAt(quickDueSunday)}
                >
                  {t("composer.preset.sunday")}
                </button>
              </div>

              <div className="composer-popup-title">
                {t("composer.section.relative")}
              </div>
              <div className="composer-popup-row">
                {quickDueRelativePresets.map((preset) => (
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
                    title={t("composer.relative.sinceNow", {
                      label: preset.label,
                    })}
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
          <div
            className="composer-popup"
            role="dialog"
            aria-label={t("composer.popup.reminder")}
          >
            <div className="composer-popup-section">
              <div className="composer-popup-title">
                {t("composer.title.reminder")}
              </div>
              <div className="composer-popup-row">
                {reminderKindOptions.map((opt) => (
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
                <div
                  className="composer-popup-row"
                  aria-label={t("composer.title.reminder")}
                >
                  {reminderOffsetPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`pill ${reminderOffset === preset.minutes ? "active" : ""}`}
                      onClick={() => setReminderOffset(preset.minutes)}
                      aria-pressed={reminderOffset === preset.minutes}
                      title={
                        preset.minutes === 0
                          ? t("reminder.offset.titleAtDue")
                          : t("reminder.offset.titleBefore", {
                              label: preset.label,
                            })
                      }
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
              {reminderKind !== "none" && (
                <div className="composer-popup-inline">
                  <span>{t("reminder.offset.before")}</span>
                  <input
                    type="number"
                    min={0}
                    className="composer-popup-number"
                    value={reminderOffset}
                    onChange={(event) =>
                      setReminderOffset(Number(event.currentTarget.value) || 0)
                    }
                  />
                  <span>{t("reminder.offset.minutes")}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {activePopup === "repeat" && (
          <div
            className="composer-popup"
            role="dialog"
            aria-label={t("composer.popup.repeat")}
          >
            <div className="composer-popup-section">
              <div className="composer-popup-title">
                {t("composer.title.repeat")}
              </div>
              <div className="composer-popup-row">
                {repeatTypeOptions.map((opt) => (
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
                    {t("repeat.workdayOnly")}
                  </button>
                </div>
              )}

              {repeat.type === "weekly" && (
                <div className="composer-popup-row">
                  {weekdayOptions.map((day) => {
                    const selected = repeat.days.includes(day.id);
                    const prefix = t("repeat.weekdayPrefix");
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
                        {prefix ? `${prefix}${day.label}` : day.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {repeat.type === "monthly" && (
                <div className="composer-popup-inline">
                  <span>{t("repeat.monthly")}</span>
                  <input
                    className="composer-popup-number"
                    type="number"
                    min={1}
                    max={31}
                    value={repeat.day}
                    onChange={(event) =>
                      setRepeat({
                        type: "monthly",
                        day: Math.min(
                          31,
                          Math.max(1, Number(event.currentTarget.value) || 1),
                        ),
                      })
                    }
                  />
                  <span>{t("repeat.dayUnit")}</span>
                </div>
              )}

              {repeat.type === "yearly" && (
                <div className="composer-popup-inline">
                  <span>{t("repeat.yearly")}</span>
                  <input
                    className="composer-popup-number"
                    type="number"
                    min={1}
                    max={12}
                    value={repeat.month}
                    onChange={(event) =>
                      setRepeat({
                        type: "yearly",
                        month: Math.min(
                          12,
                          Math.max(1, Number(event.currentTarget.value) || 1),
                        ),
                        day: repeat.day,
                      })
                    }
                  />
                  <span>{t("repeat.monthUnit")}</span>
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
                        day: Math.min(
                          31,
                          Math.max(1, Number(event.currentTarget.value) || 1),
                        ),
                      })
                    }
                  />
                  <span>{t("repeat.dayUnit")}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
