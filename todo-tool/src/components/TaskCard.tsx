import type { DragEvent } from "react";

import { formatDue } from "../date";
import { formatRepeatRule } from "../repeat";
import { isOverdue } from "../scheduler";
import type { Task } from "../types";
import { useI18n } from "../i18n";

import { IconButton } from "./IconButton";
import { Icons } from "./icons";

export function TaskCard({
  task,
  mode,
  showMove,
  draggable,
  onDragStart,
  onMoveUp,
  onMoveDown,
  onToggleComplete,
  onToggleImportant,
  onDelete,
  onEdit,
}: {
  task: Task;
  mode: "quick" | "main";
  showMove?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const now = Math.floor(Date.now() / 1000);
  const overdue = isOverdue(task, now);

  return (
    <div
      className={`task-card ${mode} q${task.quadrant} ${task.completed ? "completed" : ""} ${overdue ? "overdue" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <div className="task-row">
        <button
          type="button"
          className="task-checkbox"
          onClick={onToggleComplete}
          title={task.completed ? t("task.markIncomplete") : t("task.markComplete")}
          aria-label={task.completed ? t("task.markIncomplete") : t("task.markComplete")}
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
            {task.important && (
              <span className="task-chip important">
                <Icons.Star />
              </span>
            )}
            {task.repeat.type !== "none" && (
              <span className="task-chip" title={formatRepeatRule(task.repeat, t)}>
                <Icons.Repeat />
              </span>
            )}
            {task.reminder.kind !== "none" && (
              <span className={`task-chip ${task.reminder.kind === "forced" ? "danger" : ""}`}>
                <Icons.Bell />
              </span>
            )}
          </div>
        </div>

        <div className="task-icons">
          {showMove && (
            <>
              <IconButton className="task-icon-btn" onClick={onMoveUp} title={t("task.moveUp")} label={t("task.moveUp")}>
                <Icons.ArrowUp />
              </IconButton>
              <IconButton className="task-icon-btn" onClick={onMoveDown} title={t("task.moveDown")} label={t("task.moveDown")}>
                <Icons.ArrowDown />
              </IconButton>
            </>
          )}
          <IconButton
            className={`task-icon-btn important ${task.important ? "active" : ""}`}
            onClick={onToggleImportant}
            title={task.important ? t("task.unmarkImportant") : t("task.markImportant")}
            label={task.important ? t("task.unmarkImportant") : t("task.markImportant")}
            aria-pressed={task.important}
          >
            <Icons.Star />
          </IconButton>
          <IconButton className="task-icon-btn" onClick={onDelete} title={t("common.delete")} label={t("task.delete")}>
            <Icons.Trash />
          </IconButton>
          <IconButton className="task-icon-btn" onClick={onEdit} title={t("common.edit")} label={t("task.edit")}>
            <Icons.Edit />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

