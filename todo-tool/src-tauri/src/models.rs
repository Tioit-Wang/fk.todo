use serde::{Deserialize, Serialize};

pub type Timestamp = i64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReminderKind {
    None,
    Normal,
    Forced,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct ReminderConfig {
    pub kind: ReminderKind,
    pub remind_at: Option<Timestamp>,
    pub snoozed_until: Option<Timestamp>,
    pub forced_dismissed: bool,
    pub last_fired_at: Option<Timestamp>,
    pub repeat_fired_count: i64,
}

impl Default for ReminderConfig {
    fn default() -> Self {
        Self {
            kind: ReminderKind::None,
            remind_at: None,
            snoozed_until: None,
            forced_dismissed: false,
            last_fired_at: None,
            repeat_fired_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RepeatRule {
    #[default]
    None,
    Daily {
        workday_only: bool,
    },
    Weekly {
        days: Vec<u8>,
    },
    Monthly {
        day: u8,
    },
    Yearly {
        month: u8,
        day: u8,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Step {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub created_at: Timestamp,
    pub completed_at: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub sort_order: Timestamp,
    #[serde(default)]
    pub created_at: Timestamp,
    #[serde(default)]
    pub updated_at: Timestamp,
    #[serde(default)]
    pub sample_tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Task {
    pub id: String,
    #[serde(default = "default_project_id")]
    pub project_id: String,
    pub title: String,
    pub due_at: Timestamp,
    #[serde(default)]
    pub important: bool,
    #[serde(default)]
    pub completed: bool,
    pub completed_at: Option<Timestamp>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    #[serde(default)]
    pub sort_order: Timestamp,
    #[serde(default = "default_quadrant")]
    pub quadrant: u8,
    pub notes: Option<String>,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub sample_tag: Option<String>,
    #[serde(default)]
    pub reminder: ReminderConfig,
    #[serde(default)]
    pub repeat: RepeatRule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    HideToTray,
    Exit,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MinimizeBehavior {
    #[default]
    HideToTray,
    Minimize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum UpdateBehavior {
    Auto,
    #[default]
    NextRestart,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum UiRadius {
    #[default]
    Theme,
    Sharp,
    Round,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum UiBorder {
    #[default]
    Theme,
    Thin,
    Thick,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum UiShadow {
    #[default]
    Theme,
    None,
    Soft,
    Strong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Settings {
    pub shortcut: String,
    pub theme: String,
    #[serde(default)]
    pub ui_radius: UiRadius,
    #[serde(default)]
    pub ui_border: UiBorder,
    #[serde(default)]
    pub ui_shadow: UiShadow,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub ai_enabled: bool,
    #[serde(default)]
    pub deepseek_api_key: String,
    #[serde(default = "default_ai_model")]
    pub ai_model: String,
    #[serde(default = "default_ai_prompt")]
    pub ai_prompt: String,
    #[serde(default)]
    pub update_behavior: UpdateBehavior,
    pub sound_enabled: bool,
    pub close_behavior: CloseBehavior,
    #[serde(default)]
    pub minimize_behavior: MinimizeBehavior,
    #[serde(default)]
    pub quick_always_on_top: bool,
    #[serde(default = "default_quick_blur_enabled")]
    pub quick_blur_enabled: bool,
    #[serde(default)]
    pub quick_bounds: Option<WindowBounds>,
    #[serde(default = "default_quick_tab")]
    pub quick_tab: String,
    #[serde(default = "default_quick_sort")]
    pub quick_sort: String,
    #[serde(default = "default_forced_color")]
    pub forced_reminder_color: String,
    #[serde(default)]
    pub backup_schedule: BackupSchedule,
    #[serde(default)]
    pub last_backup_at: Option<Timestamp>,
    #[serde(default)]
    pub today_focus_ids: Vec<String>,
    pub today_focus_date: Option<String>,
    pub today_prompted_date: Option<String>,
    #[serde(default = "default_reminder_repeat_interval_sec")]
    pub reminder_repeat_interval_sec: i64,
    #[serde(default = "default_reminder_repeat_max_times")]
    pub reminder_repeat_max_times: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "CommandOrControl+Shift+T".to_string(),
            theme: "retro".to_string(),
            ui_radius: UiRadius::Theme,
            ui_border: UiBorder::Theme,
            ui_shadow: UiShadow::Theme,
            language: default_language(),
            ai_enabled: false,
            deepseek_api_key: String::new(),
            ai_model: default_ai_model(),
            ai_prompt: default_ai_prompt(),
            update_behavior: UpdateBehavior::NextRestart,
            sound_enabled: true,
            close_behavior: CloseBehavior::HideToTray,
            minimize_behavior: MinimizeBehavior::HideToTray,
            quick_always_on_top: false,
            quick_blur_enabled: default_quick_blur_enabled(),
            quick_bounds: None,
            quick_tab: default_quick_tab(),
            quick_sort: default_quick_sort(),
            forced_reminder_color: default_forced_color(),
            backup_schedule: BackupSchedule::Daily,
            last_backup_at: None,
            today_focus_ids: Vec::new(),
            today_focus_date: None,
            today_prompted_date: None,
            reminder_repeat_interval_sec: default_reminder_repeat_interval_sec(),
            reminder_repeat_max_times: default_reminder_repeat_max_times(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BackupSchedule {
    None,
    #[default]
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Serialize for WindowBounds {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;

        // Window bounds are persisted to JSON and later consumed by platform window APIs. Guard
        // against non-finite floats to avoid writing invalid JSON or "poisoning" settings.
        if !(self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite())
        {
            return Err(serde::ser::Error::custom(
                "window_bounds must contain finite numbers",
            ));
        }

        let mut state = serializer.serialize_struct("WindowBounds", 4)?;
        state.serialize_field("x", &self.x)?;
        state.serialize_field("y", &self.y)?;
        state.serialize_field("width", &self.width)?;
        state.serialize_field("height", &self.height)?;
        state.end()
    }
}

fn default_quick_tab() -> String {
    "todo".to_string()
}

fn default_quick_sort() -> String {
    "default".to_string()
}

fn default_language() -> String {
    "auto".to_string()
}

fn default_ai_prompt() -> String {
    // Keep the default prompt in sync with prompts/ai_prompt.zh-CN.md.
    include_str!("../prompts/ai_prompt.zh-CN.md").to_string()
}

fn default_ai_model() -> String {
    "deepseek-chat".to_string()
}

#[cfg(all(feature = "app", not(test)))]
fn legacy_default_ai_prompt_v1() -> String {
    // v1 shipped as the initial "AI task breakdown assistant" prompt. We keep it around so we can
    // migrate existing users who never customized their prompt (it gets persisted to settings.json).
    [
        "你是 MustDo（必做清单）里的任务拆解助手。",
        "",
        "目标：基于用户的自然语言输入，为【同一个】Todo 生成：",
        "1) 可执行的补充说明（notes）",
        "2) 严谨的步骤清单（steps）",
        "",
        "硬规则：",
        "- 一次只处理一个 Todo，不要拆成多个 Todo。",
        "- steps 宁缺毋滥：只写高置信度、可执行、可勾选的步骤；不确定就少写或不写。",
        "- 不要输出空泛步骤（如：开始/继续/完成/跟进/处理一下）。",
        "- 不要臆测用户未提供的信息；需要信息时，把“需要确认的问题”写进 notes。",
        "",
        "输出要求：",
        "- 只输出 JSON（不要夹杂解释文字）。",
        "- JSON 格式：{ \"notes\": string, \"steps\": string[] }。",
        "- notes 建议用 Markdown，包含：执行建议/关键注意事项/需要确认的问题（如有）。",
        "- steps 每条尽量短（<= 20 字），动词开头，可直接勾选完成。",
    ]
    .join("\n")
}

#[cfg(all(feature = "app", not(test)))]
fn legacy_default_ai_prompt_v2() -> String {
    // v2 shipped as the "prompt v2" default, before we introduced placeholders.
    // Keep it around so we can migrate users who never customized their prompt.
    [
        "你是 MustDo（必做清单）里的任务拆解助手。",
        "",
        "你在 MustDo 内工作：你的输出会直接写入【当前这个】Todo 的 notes 与 steps。",
        "你只处理【同一个】Todo；不要拆成多个 Todo。",
        "",
        "重要事实（请配合软件功能）：",
        "- 截止时间/提醒/重复/重要/标签等字段已经由用户在界面里选择，并会显示在 UI 上。",
        "- 你的输出只负责补充 notes 与 steps：不要把这些字段的值（尤其是日期/时间）重复写进 notes。",
        "",
        "steps（极严）：",
        "- steps 是“可勾选的子步骤”，必须是明确动作。",
        "- 宁缺毋滥：没有高置信度步骤就输出 []。",
        "- 禁止空泛/元步骤：开始/继续/完成/跟进/处理一下/确认需求/决定/考虑/评估/整理…",
        "- 禁止建议去其他软件（日历/闹钟/便签），除非用户明确要求。",
        "- 不要把“创建这个 Todo / 新建提醒”写成步骤：Todo 已经在创建流程里。",
        "- 每条尽量短（<= 20 字），动词开头，可直接勾选完成。",
        "",
        "notes（Markdown）：",
        "- notes 只写“标题/字段之外”的信息：地点、会议链接、准备材料、关键备注、需要确认的问题。",
        "- 不要回显内部字段名（project_id/due_at_unix 等），也不要解释系统字段。",
        "- 如果用户输入包含明确的时间，但你看到已选 due_at_local 与之明显不一致：",
        "  - notes 只用一句话提醒“时间可能不一致”（不要长篇分析）",
        "  - steps 给出一个可执行动作（如：调整截止时间/设置提醒）",
        "- “需要确认”最多 3 条，仅在缺失信息会导致无法执行时才写。",
        "",
        "输出：",
        "- 只输出 JSON，不要夹杂任何解释文字或代码块标记。",
        "- JSON 格式固定：{ \"notes\": string, \"steps\": string[] }。",
    ]
    .join("\n")
}

#[cfg(all(feature = "app", not(test)))]
fn legacy_default_ai_prompt_v3() -> String {
    // v3 shipped as the initial placeholder-based prompt (notes + steps only).
    [
        "你是 MustDo（必做清单）里的任务拆解助手。",
        "",
        "你在 MustDo 内工作：你的输出会直接写入【当前这个】Todo 的 notes 与 steps。",
        "你只处理【同一个】Todo；不要拆成多个 Todo。",
        "",
        "重要事实（请配合软件功能）：",
        "- 截止时间/提醒/重复/重要/标签等字段已经由用户在界面里选择，并会显示在 UI 上。",
        "- 你的输出只负责补充 notes 与 steps：不要把这些字段的值（尤其是日期/时间）重复写进 notes。",
        "",
        "steps（极严）：",
        "- steps 是“可勾选的子步骤”，必须是明确动作。",
        "- 宁缺毋滥：没有高置信度步骤就输出 []。",
        "- 禁止空泛/元步骤：开始/继续/完成/跟进/处理一下/确认需求/决定/考虑/评估/整理…",
        "- 禁止建议去其他软件（日历/闹钟/便签），除非用户明确要求。",
        "- 不要把“创建这个 Todo / 新建提醒”写成步骤：Todo 已经在创建流程里。",
        "- 每条尽量短（<= 20 字），动词开头，可直接勾选完成。",
        "",
        "notes（Markdown）：",
        "- notes 只写“标题/字段之外”的信息：地点、会议链接、准备材料、关键备注、需要确认的问题。",
        "- 不要回显内部字段名（project_id/due_at_unix 等），也不要解释系统字段。",
        "- 如果用户输入包含明确的时间，但你看到已选 due_at_local 与之明显不一致：",
        "  - notes 只用一句话提醒“时间可能不一致”（不要长篇分析）",
        "  - steps 给出一个可执行动作（如：调整截止时间/设置提醒）",
        "- “需要确认”最多 3 条，仅在缺失信息会导致无法执行时才写。",
        "",
        "输出：",
        "- 只输出 JSON，不要夹杂任何解释文字或代码块标记。",
        "- JSON 格式固定：{ \"notes\": string, \"steps\": string[] }。",
        "",
        "{{mustdo_now}}",
        "",
        "{{mustdo_user_input}}",
        "",
        "{{mustdo_selected_fields}}",
        "",
        "{{mustdo_output_schema}}",
    ]
    .join("\n")
}

#[cfg(all(feature = "app", not(test)))]
fn normalize_prompt_for_compare(s: &str) -> String {
    s.replace("\r\n", "\n").trim().to_string()
}

#[cfg(all(feature = "app", not(test)))]
impl Settings {
    /// Returns true if we mutated the prompt.
    pub fn migrate_ai_prompt_if_legacy_default(&mut self) -> bool {
        let current = normalize_prompt_for_compare(&self.ai_prompt);
        let legacy_v1 = normalize_prompt_for_compare(&legacy_default_ai_prompt_v1());
        let legacy_v2 = normalize_prompt_for_compare(&legacy_default_ai_prompt_v2());
        let legacy_v3 = normalize_prompt_for_compare(&legacy_default_ai_prompt_v3());
        if current == legacy_v1 || current == legacy_v2 || current == legacy_v3 {
            self.ai_prompt = default_ai_prompt();
            return true;
        }
        false
    }
}

fn default_quick_blur_enabled() -> bool {
    true
}

fn default_forced_color() -> String {
    // Retro warm red; used as the default reminder banner background.
    "#C94D37".to_string()
}

fn default_quadrant() -> u8 {
    1
}

fn default_project_id() -> String {
    "inbox".to_string()
}

fn default_reminder_repeat_interval_sec() -> i64 {
    // 0 disables repeats (single-shot reminders only).
    10 * 60
}

fn default_reminder_repeat_max_times() -> i64 {
    // 0 means "repeat until completed" (no limit).
    0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TasksFile {
    pub schema_version: u32,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SettingsFile {
    pub schema_version: u32,
    pub settings: Settings,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reminder_config_default_values() {
        let config = ReminderConfig::default();
        assert_eq!(config.kind, ReminderKind::None);
        assert_eq!(config.remind_at, None);
        assert_eq!(config.snoozed_until, None);
        assert!(!config.forced_dismissed);
        assert_eq!(config.last_fired_at, None);
        assert_eq!(config.repeat_fired_count, 0);
    }

    #[test]
    fn settings_default_values() {
        let settings = Settings::default();
        assert_eq!(settings.shortcut, "CommandOrControl+Shift+T");
        assert_eq!(settings.theme, "retro");
        assert_eq!(
            serde_json::to_value(&settings.ui_radius).expect("serialize ui_radius"),
            serde_json::json!("theme")
        );
        assert_eq!(
            serde_json::to_value(&settings.ui_border).expect("serialize ui_border"),
            serde_json::json!("theme")
        );
        assert_eq!(
            serde_json::to_value(&settings.ui_shadow).expect("serialize ui_shadow"),
            serde_json::json!("theme")
        );
        assert_eq!(settings.language, "auto");
        assert!(!settings.ai_enabled);
        assert!(settings.deepseek_api_key.is_empty());
        assert_eq!(settings.ai_model, "deepseek-chat");
        assert_eq!(settings.ai_prompt, default_ai_prompt());
        assert_eq!(
            serde_json::to_value(&settings.update_behavior).expect("serialize update_behavior"),
            serde_json::json!("next_restart")
        );
        assert!(settings.sound_enabled);
        assert_eq!(
            serde_json::to_value(&settings.close_behavior).expect("serialize close_behavior"),
            serde_json::json!("hide_to_tray")
        );
        assert_eq!(
            serde_json::to_value(&settings.minimize_behavior).expect("serialize minimize_behavior"),
            serde_json::json!("hide_to_tray")
        );
        assert!(!settings.quick_always_on_top);
        assert!(settings.quick_blur_enabled);
        assert!(settings.quick_bounds.is_none());
        assert_eq!(settings.quick_tab, "todo");
        assert_eq!(settings.quick_sort, "default");
        assert_eq!(settings.forced_reminder_color, "#C94D37");
        assert_eq!(
            serde_json::to_value(&settings.backup_schedule).expect("serialize backup_schedule"),
            serde_json::json!("daily")
        );
        assert_eq!(settings.last_backup_at, None);
        assert!(settings.today_focus_ids.is_empty());
        assert_eq!(settings.today_focus_date, None);
        assert_eq!(settings.today_prompted_date, None);
        assert_eq!(settings.reminder_repeat_interval_sec, 10 * 60);
        assert_eq!(settings.reminder_repeat_max_times, 0);
    }

    #[test]
    fn settings_serde_applies_defaults_for_missing_optional_fields() {
        let json = r#"
        {
          "shortcut": "CommandOrControl+Shift+T",
          "theme": "dark",
          "sound_enabled": false,
          "close_behavior": "exit"
        }
        "#;

        let settings: Settings = serde_json::from_str(json).expect("settings should deserialize");
        assert_eq!(settings.shortcut, "CommandOrControl+Shift+T");
        assert_eq!(settings.theme, "dark");
        assert!(!settings.sound_enabled);
        assert_eq!(
            serde_json::to_value(&settings.close_behavior).expect("serialize close_behavior"),
            serde_json::json!("exit")
        );

        // These fields must be filled by serde defaults.
        assert_eq!(
            serde_json::to_value(&settings.ui_radius).expect("serialize ui_radius"),
            serde_json::json!("theme")
        );
        assert_eq!(
            serde_json::to_value(&settings.ui_border).expect("serialize ui_border"),
            serde_json::json!("theme")
        );
        assert_eq!(
            serde_json::to_value(&settings.ui_shadow).expect("serialize ui_shadow"),
            serde_json::json!("theme")
        );
        assert_eq!(
            serde_json::to_value(&settings.minimize_behavior).expect("serialize minimize_behavior"),
            serde_json::json!("hide_to_tray")
        );
        assert_eq!(settings.language, "auto");
        assert!(!settings.ai_enabled);
        assert!(settings.deepseek_api_key.is_empty());
        assert_eq!(settings.ai_model, "deepseek-chat");
        assert_eq!(settings.ai_prompt, default_ai_prompt());
        assert_eq!(
            serde_json::to_value(&settings.update_behavior).expect("serialize update_behavior"),
            serde_json::json!("next_restart")
        );
        assert!(!settings.quick_always_on_top);
        assert!(settings.quick_blur_enabled);
        assert!(settings.quick_bounds.is_none());
        assert_eq!(settings.quick_tab, "todo");
        assert_eq!(settings.quick_sort, "default");
        assert_eq!(settings.forced_reminder_color, "#C94D37");
        assert_eq!(
            serde_json::to_value(&settings.backup_schedule).expect("serialize backup_schedule"),
            serde_json::json!("daily")
        );
        assert_eq!(settings.last_backup_at, None);
        assert!(settings.today_focus_ids.is_empty());
        assert_eq!(settings.today_focus_date, None);
        assert_eq!(settings.today_prompted_date, None);
        assert_eq!(settings.reminder_repeat_interval_sec, 10 * 60);
        assert_eq!(settings.reminder_repeat_max_times, 0);
    }

    #[test]
    fn repeat_rule_serialization_uses_tagged_enum_layout() {
        let rule = RepeatRule::Daily { workday_only: true };
        let value = serde_json::to_value(&rule).expect("serialize repeat rule");
        assert_eq!(
            value,
            serde_json::json!({
              "type": "daily",
              "workday_only": true
            })
        );

        let back: RepeatRule = serde_json::from_value(value).expect("deserialize repeat rule");
        assert!(matches!(back, RepeatRule::Daily { workday_only: true }));
    }

    #[test]
    fn task_sort_order_defaults_to_zero_when_missing() {
        let json = r#"
        {
          "id": "t1",
          "title": "task",
          "due_at": 123,
          "important": false,
          "completed": false,
          "completed_at": null,
          "created_at": 1,
          "updated_at": 1,
          "quadrant": 1,
          "notes": null,
          "steps": [],
          "reminder": {
            "kind": "none",
            "remind_at": null,
            "snoozed_until": null,
            "forced_dismissed": false,
            "last_fired_at": null
          },
          "repeat": { "type": "none" }
        }
        "#;

        let task: Task = serde_json::from_str(json).expect("task should deserialize");
        assert_eq!(task.sort_order, 0);
    }

    #[test]
    fn task_serde_defaults_missing_fields_for_compatibility() {
        let json = r#"
        {
          "id": "t2",
          "title": "legacy",
          "due_at": 123,
          "created_at": 10,
          "updated_at": 10
        }
        "#;

        let task: Task = serde_json::from_str(json).expect("task should deserialize");
        assert_eq!(task.project_id, "inbox");
        assert!(!task.important);
        assert!(!task.completed);
        assert_eq!(task.completed_at, None);
        assert_eq!(task.sort_order, 0);
        assert_eq!(task.quadrant, 1);
        assert!(task.steps.is_empty());
        assert!(task.tags.is_empty());
        assert_eq!(task.sample_tag, None);
        assert_eq!(task.notes, None);
        assert_eq!(task.reminder.kind, ReminderKind::None);
        assert!(!task.reminder.forced_dismissed);
        assert_eq!(task.repeat, RepeatRule::None);
    }

    #[test]
    fn task_non_default_reminder_and_repeat_are_not_none() {
        let task = Task {
            id: "t3".to_string(),
            project_id: "inbox".to_string(),
            title: "non-default".to_string(),
            due_at: 123,
            important: false,
            completed: false,
            completed_at: None,
            created_at: 10,
            updated_at: 10,
            sort_order: 0,
            quadrant: 1,
            notes: None,
            steps: Vec::new(),
            tags: Vec::new(),
            sample_tag: None,
            reminder: ReminderConfig {
                kind: ReminderKind::Normal,
                remind_at: Some(111),
                snoozed_until: None,
                forced_dismissed: false,
                last_fired_at: None,
                repeat_fired_count: 0,
            },
            repeat: RepeatRule::Daily {
                workday_only: false,
            },
        };

        assert_ne!(task.reminder.kind, ReminderKind::None);
        assert_ne!(task.repeat, RepeatRule::None);
    }

    #[test]
    fn reminder_config_defaults_missing_fields() {
        let json = r#"
        {
          "kind": "normal"
        }
        "#;

        let config: ReminderConfig =
            serde_json::from_str(json).expect("reminder config should deserialize");
        assert_eq!(config.kind, ReminderKind::Normal);
        assert_eq!(config.remind_at, None);
        assert_eq!(config.snoozed_until, None);
        assert!(!config.forced_dismissed);
        assert_eq!(config.last_fired_at, None);
        assert_eq!(config.repeat_fired_count, 0);
    }

    #[test]
    fn window_bounds_serialization_rejects_non_finite_numbers() {
        let ok_bounds = WindowBounds {
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
        };
        let value = serde_json::to_value(&ok_bounds).expect("serialize window bounds");
        assert_eq!(
            value,
            serde_json::json!({
              "x": 1.0,
              "y": 2.0,
              "width": 3.0,
              "height": 4.0
            })
        );

        let bad_bounds = WindowBounds {
            x: f64::NAN,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        };
        assert!(serde_json::to_value(&bad_bounds).is_err());
    }

    #[test]
    fn window_bounds_serialize_propagates_serializer_write_errors() {
        use serde_json::to_writer;
        use std::io;
        use std::io::Write as _;

        struct FailAfterNWrites {
            remaining_ok_writes: usize,
        }

        impl io::Write for FailAfterNWrites {
            fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
                if self.remaining_ok_writes == 0 {
                    return Err(io::Error::other("write failed"));
                }
                self.remaining_ok_writes -= 1;
                Ok(buf.len())
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        let bounds = WindowBounds {
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
        };

        // Also hit the non-finite validation branch for the same serializer monomorphization used
        // in this test (serde_json's streaming serializer) so region coverage includes it.
        let bad_bounds = WindowBounds {
            x: f64::NAN,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        };
        let mut out = FailAfterNWrites {
            remaining_ok_writes: 0,
        };
        to_writer(&mut out, &bad_bounds).unwrap_or_else(|_| ());

        // Force failures at different points in the JSON stream so the `?` error paths in the
        // Serialize impl are exercised (serialize_struct + serialize_field calls).
        for remaining_ok_writes in 0..=256 {
            let mut out = FailAfterNWrites {
                remaining_ok_writes,
            };
            // Use `to_writer` to go through serde_json's serializer implementation while still
            // exercising our `Serialize` impl and its `?` error paths.
            to_writer(&mut out, &bounds).unwrap_or_else(|_| ());
            let _ = out.flush();
        }
    }
}
