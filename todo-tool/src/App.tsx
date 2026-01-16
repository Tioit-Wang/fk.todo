import "./App.css";

// ============================================================================
// PLACEHOLDER DATA - Replace with actual data from state/props
// ============================================================================
const PLACEHOLDER_TASKS = [
  { id: 1, title: "Review quarterly report", dueTime: "10:30 AM", isImportant: true, isUrgent: true, hasSteps: true, stepCount: 3, completedSteps: 1 },
  { id: 2, title: "Team standup meeting", dueTime: "11:00 AM", isImportant: true, isUrgent: false, hasSteps: false, stepCount: 0, completedSteps: 0 },
  { id: 3, title: "Update documentation", dueTime: "2:00 PM", isImportant: false, isUrgent: true, hasSteps: true, stepCount: 5, completedSteps: 3 },
  { id: 4, title: "Code review for PR #142", dueTime: "4:00 PM", isImportant: false, isUrgent: false, hasSteps: false, stepCount: 0, completedSteps: 0 },
  { id: 5, title: "Prepare presentation slides", dueTime: "Tomorrow", isImportant: true, isUrgent: false, hasSteps: true, stepCount: 4, completedSteps: 0 },
];

const PLACEHOLDER_STEPS = [
  { id: 1, title: "Gather data from analytics", completed: true },
  { id: 2, title: "Create summary charts", completed: false },
  { id: 3, title: "Write executive summary", completed: false },
];

const FILTER_TABS = ["All", "Today", "Important", "Planned"];

// ============================================================================
// ICON COMPONENTS (SVG placeholders - inline for no dependencies)
// ============================================================================
const Icons = {
  Star: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  Calendar: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Bell: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  Repeat: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  Plus: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Check: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  ChevronDown: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  ChevronRight: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  Grid: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  List: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  Filter: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  Sort: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="6" x2="11" y2="6" />
      <line x1="4" y1="12" x2="11" y2="12" />
      <line x1="4" y1="18" x2="13" y2="18" />
      <polyline points="15 15 18 18 21 15" />
      <line x1="18" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Trash: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Move: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  ),
  Clock: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  X: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  AlertCircle: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Snooze: () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 11h6L4 19h6" />
      <path d="M14 7h6l-6 8h6" />
    </svg>
  ),
};

// ============================================================================
// QUICK WINDOW VIEW
// ============================================================================
function QuickWindow({
  onTaskClick,
  onAddTask,
  onToggleComplete,
  onToggleImportant,
  onExpandSteps,
}: {
  onTaskClick?: (taskId: number) => void;
  onAddTask?: (title: string) => void;
  onToggleComplete?: (taskId: number) => void;
  onToggleImportant?: (taskId: number) => void;
  onExpandSteps?: (taskId: number) => void;
}) {
  // Placeholder: expanded task ID would come from state
  const expandedTaskId = 1;
  // Placeholder: active filter would come from state
  const activeFilter = "All";
  // Placeholder: input value would come from state
  const inputValue = "";
  // Placeholder: due time preview
  const dueTimePreview = "Today, 5:00 PM";

  return (
    <div className="quick-window">
      {/* Filter Tabs */}
      <div className="quick-filter-tabs">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            className={`quick-filter-tab ${activeFilter === tab ? "active" : ""}`}
            /* onClick={() => onFilterChange?.(tab)} */
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="quick-task-list">
        {PLACEHOLDER_TASKS.map((task) => (
          <div key={task.id} className="quick-task-item">
            <div className="quick-task-row" onClick={() => onTaskClick?.(task.id)}>
              {/* Checkbox */}
              <button
                className="task-checkbox"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleComplete?.(task.id);
                }}
              >
                <Icons.Check />
              </button>

              {/* Task Content */}
              <div className="task-content">
                <span className="task-title">{task.title}</span>
                <div className="task-meta">
                  <span className="task-due-time">
                    <Icons.Clock />
                    {task.dueTime}
                  </span>
                  {task.hasSteps && (
                    <span className="task-steps-count">
                      {task.completedSteps}/{task.stepCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Task Icons */}
              <div className="task-icons">
                {task.isImportant && (
                  <button
                    className="task-icon-btn important active"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleImportant?.(task.id);
                    }}
                  >
                    <Icons.Star />
                  </button>
                )}
                {task.hasSteps && (
                  <button
                    className="task-icon-btn expand"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExpandSteps?.(task.id);
                    }}
                  >
                    {expandedTaskId === task.id ? <Icons.ChevronDown /> : <Icons.ChevronRight />}
                  </button>
                )}
              </div>
            </div>

            {/* Expanded Steps */}
            {expandedTaskId === task.id && task.hasSteps && (
              <div className="quick-task-steps">
                {PLACEHOLDER_STEPS.map((step) => (
                  <div key={step.id} className={`step-item ${step.completed ? "completed" : ""}`}>
                    <button className="step-checkbox">
                      {step.completed && <Icons.Check />}
                    </button>
                    <span className="step-title">{step.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input Bar */}
      <div className="quick-input-bar">
        <div className="quick-input-wrapper">
          <input
            type="text"
            className="quick-input"
            placeholder="Add a task..."
            value={inputValue}
            /* onChange={(e) => setInputValue(e.target.value)} */
            /* onKeyDown={(e) => e.key === 'Enter' && onAddTask?.(inputValue)} */
          />
          <div className="quick-input-actions">
            <button className="quick-input-btn" title="Set due date">
              <Icons.Calendar />
            </button>
            <button className="quick-input-btn" title="Set reminder">
              <Icons.Bell />
            </button>
            <button className="quick-input-btn" title="Set repeat">
              <Icons.Repeat />
            </button>
            <button className="quick-input-btn" title="Mark important">
              <Icons.Star />
            </button>
          </div>
        </div>
        {dueTimePreview && (
          <div className="quick-due-preview">
            <Icons.Clock />
            <span>{dueTimePreview}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN WINDOW VIEW
// ============================================================================
function MainWindow({
  onTaskClick,
  onViewModeChange,
  onBatchDelete,
  onBatchMove,
  onBatchComplete,
}: {
  onTaskClick?: (taskId: number) => void;
  onViewModeChange?: (mode: "grid" | "list") => void;
  onBatchDelete?: (taskIds: number[]) => void;
  onBatchMove?: (taskIds: number[], quadrant: string) => void;
  onBatchComplete?: (taskIds: number[]) => void;
}) {
  // Placeholder: view mode would come from state
  const viewMode: "grid" | "list" = "grid";
  // Placeholder: selected tasks would come from state
  const selectedTasks: number[] = [1, 3];
  // Placeholder: active filter
  const activeFilter = "All";

  // Quadrant definitions
  const quadrants = [
    { id: "urgent-important", label: "Do First", sublabel: "Urgent & Important", color: "red" },
    { id: "not-urgent-important", label: "Schedule", sublabel: "Important, Not Urgent", color: "amber" },
    { id: "urgent-not-important", label: "Delegate", sublabel: "Urgent, Not Important", color: "blue" },
    { id: "not-urgent-not-important", label: "Eliminate", sublabel: "Neither", color: "gray" },
  ];

  // Filter tasks by quadrant (placeholder logic)
  const getTasksForQuadrant = (quadrantId: string) => {
    return PLACEHOLDER_TASKS.filter((task) => {
      if (quadrantId === "urgent-important") return task.isUrgent && task.isImportant;
      if (quadrantId === "not-urgent-important") return !task.isUrgent && task.isImportant;
      if (quadrantId === "urgent-not-important") return task.isUrgent && !task.isImportant;
      return !task.isUrgent && !task.isImportant;
    });
  };

  return (
    <div className="main-window">
      {/* Header */}
      <header className="main-header">
        <div className="main-header-left">
          <h1 className="main-title">Tasks</h1>
          <div className="main-filters">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab}
                className={`main-filter-btn ${activeFilter === tab ? "active" : ""}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="main-header-right">
          <button className="main-action-btn">
            <Icons.Filter />
            <span>Filter</span>
          </button>
          <button className="main-action-btn">
            <Icons.Sort />
            <span>Sort</span>
          </button>
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => onViewModeChange?.("grid")}
            >
              <Icons.Grid />
            </button>
            <button
              className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => onViewModeChange?.("list")}
            >
              <Icons.List />
            </button>
          </div>
        </div>
      </header>

      {/* Batch Actions Bar */}
      {selectedTasks.length > 0 && (
        <div className="batch-actions-bar">
          <span className="batch-count">{selectedTasks.length} selected</span>
          <div className="batch-actions">
            <button className="batch-btn" onClick={() => onBatchComplete?.(selectedTasks)}>
              <Icons.Check />
              <span>Complete</span>
            </button>
            <button className="batch-btn" onClick={() => onBatchMove?.(selectedTasks, "")}>
              <Icons.Move />
              <span>Move</span>
            </button>
            <button className="batch-btn danger" onClick={() => onBatchDelete?.(selectedTasks)}>
              <Icons.Trash />
              <span>Delete</span>
            </button>
          </div>
          <button className="batch-close">
            <Icons.X />
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="main-content">
        {viewMode === "grid" ? (
          /* 4 Quadrant Grid View */
          <div className="quadrant-grid">
            {quadrants.map((quadrant) => (
              <div key={quadrant.id} className={`quadrant quadrant-${quadrant.color}`}>
                <div className="quadrant-header">
                  <h2 className="quadrant-title">{quadrant.label}</h2>
                  <span className="quadrant-sublabel">{quadrant.sublabel}</span>
                </div>
                <div className="quadrant-tasks">
                  {getTasksForQuadrant(quadrant.id).map((task) => (
                    <div
                      key={task.id}
                      className={`quadrant-task-card ${selectedTasks.includes(task.id) ? "selected" : ""}`}
                      onClick={() => onTaskClick?.(task.id)}
                    >
                      <div className="card-checkbox">
                        <input type="checkbox" checked={selectedTasks.includes(task.id)} readOnly />
                      </div>
                      <div className="card-content">
                        <span className="card-title">{task.title}</span>
                        <div className="card-meta">
                          <span className="card-due">
                            <Icons.Clock />
                            {task.dueTime}
                          </span>
                          {task.hasSteps && (
                            <span className="card-steps">
                              {task.completedSteps}/{task.stepCount}
                            </span>
                          )}
                        </div>
                      </div>
                      {task.isImportant && (
                        <div className="card-important">
                          <Icons.Star />
                        </div>
                      )}
                    </div>
                  ))}
                  {getTasksForQuadrant(quadrant.id).length === 0 && (
                    <div className="quadrant-empty">No tasks</div>
                  )}
                </div>
                <button className="quadrant-add-btn">
                  <Icons.Plus />
                  <span>Add task</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="list-view">
            <div className="list-header">
              <div className="list-col-checkbox"></div>
              <div className="list-col-title">Task</div>
              <div className="list-col-due">Due</div>
              <div className="list-col-quadrant">Quadrant</div>
              <div className="list-col-actions"></div>
            </div>
            <div className="list-body">
              {PLACEHOLDER_TASKS.map((task) => (
                <div
                  key={task.id}
                  className={`list-row ${selectedTasks.includes(task.id) ? "selected" : ""}`}
                  onClick={() => onTaskClick?.(task.id)}
                >
                  <div className="list-col-checkbox">
                    <input type="checkbox" checked={selectedTasks.includes(task.id)} readOnly />
                  </div>
                  <div className="list-col-title">
                    <span className="list-task-title">{task.title}</span>
                    {task.hasSteps && (
                      <span className="list-steps-badge">
                        {task.completedSteps}/{task.stepCount}
                      </span>
                    )}
                  </div>
                  <div className="list-col-due">
                    <Icons.Clock />
                    {task.dueTime}
                  </div>
                  <div className="list-col-quadrant">
                    <span className={`quadrant-badge ${task.isUrgent && task.isImportant ? "red" : task.isImportant ? "amber" : task.isUrgent ? "blue" : "gray"}`}>
                      {task.isUrgent && task.isImportant
                        ? "Do First"
                        : task.isImportant
                        ? "Schedule"
                        : task.isUrgent
                        ? "Delegate"
                        : "Eliminate"}
                    </span>
                  </div>
                  <div className="list-col-actions">
                    {task.isImportant && (
                      <span className="list-important">
                        <Icons.Star />
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// REMINDER OVERLAY VIEW
// ============================================================================
function ReminderOverlay({
  onDismiss,
  onSnooze,
  onComplete,
}: {
  onDismiss?: () => void;
  onSnooze?: (minutes: number) => void;
  onComplete?: () => void;
}) {
  // Placeholder: reminder data would come from props/state
  const reminder = {
    taskTitle: "Review quarterly report",
    dueTime: "10:30 AM",
    isImportant: true,
    isOverdue: true,
  };

  return (
    <div className="reminder-overlay">
      <div className="reminder-banner">
        <div className="reminder-indicator"></div>
        
        <div className="reminder-content">
          <div className="reminder-header">
            <Icons.AlertCircle />
            <span className="reminder-label">
              {reminder.isOverdue ? "Overdue" : "Reminder"}
            </span>
          </div>
          
          <h2 className="reminder-title">{reminder.taskTitle}</h2>
          
          <div className="reminder-meta">
            <span className="reminder-time">
              <Icons.Clock />
              {reminder.dueTime}
            </span>
            {reminder.isImportant && (
              <span className="reminder-important">
                <Icons.Star />
                Important
              </span>
            )}
          </div>
        </div>

        <div className="reminder-actions">
          <button className="reminder-btn secondary" onClick={onDismiss}>
            <Icons.X />
            <span>Dismiss</span>
          </button>
          <button className="reminder-btn secondary" onClick={() => onSnooze?.(15)}>
            <Icons.Snooze />
            <span>Snooze 15m</span>
          </button>
          <button className="reminder-btn primary" onClick={onComplete}>
            <Icons.Check />
            <span>Complete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================
function App() {
  // Placeholder: view would be determined by window.location.hash or props
  // Possible values: "quick", "main", "reminder"
  const getViewFromHash = (): "quick" | "main" | "reminder" => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "main") return "main";
    if (hash === "reminder") return "reminder";
    return "quick"; // default
  };

  const view = getViewFromHash();

  // Placeholder event handlers - to be implemented with actual logic
  const handleTaskClick = (taskId: number) => {
    console.log("Task clicked:", taskId);
  };

  const handleAddTask = (title: string) => {
    console.log("Add task:", title);
  };

  const handleToggleComplete = (taskId: number) => {
    console.log("Toggle complete:", taskId);
  };

  const handleToggleImportant = (taskId: number) => {
    console.log("Toggle important:", taskId);
  };

  const handleExpandSteps = (taskId: number) => {
    console.log("Expand steps:", taskId);
  };

  const handleViewModeChange = (mode: "grid" | "list") => {
    console.log("View mode:", mode);
  };

  const handleBatchDelete = (taskIds: number[]) => {
    console.log("Batch delete:", taskIds);
  };

  const handleBatchMove = (taskIds: number[], quadrant: string) => {
    console.log("Batch move:", taskIds, quadrant);
  };

  const handleBatchComplete = (taskIds: number[]) => {
    console.log("Batch complete:", taskIds);
  };

  const handleDismissReminder = () => {
    console.log("Dismiss reminder");
  };

  const handleSnoozeReminder = (minutes: number) => {
    console.log("Snooze reminder:", minutes);
  };

  const handleCompleteReminder = () => {
    console.log("Complete reminder task");
  };

  return (
    <div className="app-container">
      {view === "quick" && (
        <QuickWindow
          onTaskClick={handleTaskClick}
          onAddTask={handleAddTask}
          onToggleComplete={handleToggleComplete}
          onToggleImportant={handleToggleImportant}
          onExpandSteps={handleExpandSteps}
        />
      )}

      {view === "main" && (
        <MainWindow
          onTaskClick={handleTaskClick}
          onViewModeChange={handleViewModeChange}
          onBatchDelete={handleBatchDelete}
          onBatchMove={handleBatchMove}
          onBatchComplete={handleBatchComplete}
        />
      )}

      {view === "reminder" && (
        <ReminderOverlay
          onDismiss={handleDismissReminder}
          onSnooze={handleSnoozeReminder}
          onComplete={handleCompleteReminder}
        />
      )}
    </div>
  );
}

export default App;
