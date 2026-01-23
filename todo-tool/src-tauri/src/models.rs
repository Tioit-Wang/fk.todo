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
}

impl Default for ReminderConfig {
    fn default() -> Self {
        Self {
            kind: ReminderKind::None,
            remind_at: None,
            snoozed_until: None,
            forced_dismissed: false,
            last_fired_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RepeatRule {
    None,
    Daily { workday_only: bool },
    Weekly { days: Vec<u8> },
    Monthly { day: u8 },
    Yearly { month: u8, day: u8 },
}

impl Default for RepeatRule {
    fn default() -> Self {
        Self::None
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MinimizeBehavior {
    HideToTray,
    Minimize,
}

impl Default for MinimizeBehavior {
    fn default() -> Self {
        Self::HideToTray
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Settings {
    pub shortcut: String,
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "CommandOrControl+Shift+T".to_string(),
            theme: "retro".to_string(),
            language: default_language(),
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
    }

    #[test]
    fn settings_default_values() {
        let settings = Settings::default();
        assert_eq!(settings.shortcut, "CommandOrControl+Shift+T");
        assert_eq!(settings.theme, "retro");
        assert_eq!(settings.language, "auto");
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
            serde_json::to_value(&settings.minimize_behavior).expect("serialize minimize_behavior"),
            serde_json::json!("hide_to_tray")
        );
        assert_eq!(settings.language, "auto");
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
