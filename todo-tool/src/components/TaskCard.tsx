import type { DragEvent } from "react";

import { formatDue } from "../date";
import { formatRepeatRule } from "../repeat";
import { isOverdue } from "../scheduler";
import type { Task } from "../types";

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
          title={task.completed ? "标记为未完成" : "标记为完成"}
          aria-label={task.completed ? "标记为未完成" : "标记为完成"}
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
              <span className="task-chip" title={formatRepeatRule(task.repeat)}>
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
              <button type="button" className="task-icon-btn" onClick={onMoveUp} title="上移" aria-label="上移">
                <Icons.ArrowUp />
              </button>
              <button type="button" className="task-icon-btn" onClick={onMoveDown} title="下移" aria-label="下移">
                <Icons.ArrowDown />
              </button>
            </>
          )}
          <button
            type="button"
            className={`task-icon-btn important ${task.important ? "active" : ""}`}
            onClick={onToggleImportant}
            title={task.important ? "取消重要" : "标记重要"}
            aria-label={task.important ? "取消标记重要" : "标记为重要"}
            aria-pressed={task.important}
          >
            <Icons.Star />
          </button>
          <button type="button" className="task-icon-btn" onClick={onDelete} title="删除" aria-label="删除任务">
            <Icons.Trash />
          </button>
          <button type="button" className="task-icon-btn" onClick={onEdit} title="编辑" aria-label="编辑任务">
            <Icons.Edit />
          </button>
        </div>
      </div>
    </div>
  );
}

