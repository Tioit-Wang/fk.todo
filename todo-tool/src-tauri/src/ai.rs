use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};

use crate::models::{Project, ReminderKind, RepeatRule, Settings, Task, Timestamp};

// Legacy placeholders (v1/v2/v3 prompt style).
const PLACEHOLDER_NOW_LEGACY: &str = "{{mustdo_now}}";
const PLACEHOLDER_USER_INPUT_LEGACY: &str = "{{mustdo_user_input}}";
const PLACEHOLDER_SELECTED_FIELDS_LEGACY: &str = "{{mustdo_selected_fields}}";
const PLACEHOLDER_OUTPUT_SCHEMA_LEGACY: &str = "{{mustdo_output_schema}}";

// New placeholders (task understanding + base field completion).
const PLACEHOLDER_NOW: &str = "{{Now}}";
const PLACEHOLDER_USER_INPUT: &str = "{{UserInput}}";
const PLACEHOLDER_USER_CURRENT_PROJECT_ID: &str = "{{UserCurrentProjectId}}";
const PLACEHOLDER_PROJECT_LIST: &str = "{{ProjectList}}";
const PLACEHOLDER_OPEN_TASKS: &str = "{{OpenTasks}}";
const PLACEHOLDER_USER_SELECTED_REMINDER: &str = "{{UserSelectedReminder}}";
const PLACEHOLDER_USER_SELECTED_REPEAT: &str = "{{UserSelectedRepeat}}";
const PLACEHOLDER_WORK_END_TIME: &str = "{{WorkEndTime}}";

const DEFAULT_WORK_END_TIME: &str = "18:00:00";
const MAX_OPEN_TASKS_CHARS: usize = 8_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AiPlanRequest {
    pub raw_input: String,
    pub title: String,
    pub project_id: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub due_at: Timestamp,
    pub important: bool,
    pub repeat: RepeatRule,
    pub reminder_kind: ReminderKind,
    pub reminder_offset_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AiPlan {
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub title: String,
    pub due_at: Option<String>,
    pub important: Option<bool>,
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "deserialize_steps")]
    pub steps: Vec<AiStep>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub sample_tag: Option<String>,
    pub reminder: Option<AiReminder>,
    pub repeat: Option<RepeatRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AiStep {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AiReminder {
    pub kind: Option<ReminderKind>,
    pub remind_at: Option<String>,
    pub forced_dismissed: Option<bool>,
}

fn deserialize_steps<'de, D>(deserializer: D) -> Result<Vec<AiStep>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize as _;
    use serde_json::Value;

    let value = Value::deserialize(deserializer)?;
    let Value::Array(items) = value else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for item in items {
        match item {
            Value::String(title) => out.push(AiStep { title }),
            Value::Object(map) => {
                if let Some(Value::String(title)) = map.get("title") {
                    out.push(AiStep {
                        title: title.to_string(),
                    });
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

fn format_local(ts: Timestamp) -> String {
    // Best-effort local time formatting for prompt readability.
    Local
        .timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| format!("{ts}"))
}

fn build_now_block(now: Timestamp) -> String {
    format!(
        "【当前时间】\n- now_unix: {now}\n- now_local: {now_local}\n",
        now_local = format_local(now)
    )
}

fn build_user_input_block(input: &AiPlanRequest) -> String {
    format!(
        "【用户输入原文】\n{raw}\n\n【解析后的标题（用于任务标题，不要求你重写）】\n{title}\n",
        raw = input.raw_input.trim(),
        title = input.title.trim()
    )
}

fn build_selected_fields_block(
    input: &AiPlanRequest,
    reminder_kind_json: &str,
    repeat_json: &str,
) -> String {
    format!(
        "【用户已选择字段（高优先级，不得更改）】\n\
 - project_id: {project_id}\n\
 - due_at_unix: {due_at}\n\
 - due_at_local: {due_local}\n\
 - important: {important}\n\
 - reminder_kind: {reminder_kind_json}\n\
 - reminder_offset_minutes: {reminder_offset_minutes}\n\
 - repeat: {repeat_json}\n\
 - tags: {tags}\n",
        project_id = input.project_id,
        due_at = input.due_at,
        due_local = format_local(input.due_at),
        important = input.important,
        reminder_kind_json = reminder_kind_json,
        reminder_offset_minutes = input.reminder_offset_minutes,
        repeat_json = repeat_json,
        tags = serde_json::to_string(&input.tags).unwrap_or_else(|_| "[]".to_string()),
    )
}

fn build_output_schema_block() -> &'static str {
    "请严格按 JSON 输出：\n{\"notes\":\"...\",\"steps\":[\"...\",\"...\"]}\n"
}

fn build_project_list_block(projects: &[Project]) -> String {
    #[derive(Serialize)]
    struct ProjectLite<'a> {
        id: &'a str,
        name: &'a str,
        sample_tag: &'a Option<String>,
    }

    let list: Vec<ProjectLite<'_>> = projects
        .iter()
        .map(|p| ProjectLite {
            id: p.id.as_str(),
            name: p.name.as_str(),
            sample_tag: &p.sample_tag,
        })
        .collect();

    serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string())
}

fn build_open_tasks_block(tasks: &[Task], projects: &[Project]) -> String {
    use std::collections::HashMap;

    let project_name_by_id: HashMap<&str, &str> = projects
        .iter()
        .map(|p| (p.id.as_str(), p.name.as_str()))
        .collect();

    let mut open: Vec<&Task> = tasks.iter().filter(|t| !t.completed).collect();
    // Helpful ordering: due soon + important first.
    open.sort_by_key(|t| (t.due_at, !t.important, t.created_at));

    let mut out = String::new();
    out.push('[');

    let mut first = true;
    for task in open {
        let entry = serde_json::json!({
          "project_id": task.project_id,
          "project_name": project_name_by_id.get(task.project_id.as_str()).copied().unwrap_or(""),
          "title": task.title,
          "due_at": format_local(task.due_at),
          "important": task.important,
          "tags": task.tags,
        });
        let line = match serde_json::to_string(&entry) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let extra = if first { line.len() } else { 2 + line.len() };
        if out.len() + extra + 2 > MAX_OPEN_TASKS_CHARS {
            break;
        }

        if !first {
            out.push_str(",\n");
        }
        first = false;
        out.push_str(&line);
    }

    if !first {
        out.push('\n');
    }
    out.push(']');
    out
}

fn build_user_selected_reminder_block(input: &AiPlanRequest, now: Timestamp) -> String {
    if input.reminder_kind == ReminderKind::None {
        return "null".to_string();
    }

    let remind_at_unix = (input.due_at - input.reminder_offset_minutes * 60).max(now);
    let value = serde_json::json!({
      "kind": input.reminder_kind,
      "remind_at": format_local(remind_at_unix),
      "forced_dismissed": false,
    });
    serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string())
}

fn build_user_selected_repeat_block(input: &AiPlanRequest) -> String {
    if matches!(input.repeat, RepeatRule::None) {
        return "null".to_string();
    }
    serde_json::to_string(&input.repeat).unwrap_or_else(|_| "null".to_string())
}

pub fn build_prompt(
    settings: &Settings,
    input: &AiPlanRequest,
    now: Timestamp,
    projects: &[Project],
    tasks: &[Task],
) -> (String, String) {
    let system = [
        "你是 MustDo（必做清单）里的任务理解与基础数据补充助手。",
        "你必须只输出 JSON（不要夹杂解释/寒暄/代码块标记）。",
        "严格遵守用户消息中给出的约束与输出结构。",
    ]
    .join("\n");

    let reminder_kind_json =
        serde_json::to_string(&input.reminder_kind).unwrap_or_else(|_| "\"none\"".to_string());
    let repeat_json =
        serde_json::to_string(&input.repeat).unwrap_or_else(|_| "{\"type\":\"none\"}".to_string());

    let has_new_placeholders = [
        PLACEHOLDER_NOW,
        PLACEHOLDER_USER_INPUT,
        PLACEHOLDER_USER_CURRENT_PROJECT_ID,
        PLACEHOLDER_PROJECT_LIST,
        PLACEHOLDER_OPEN_TASKS,
        PLACEHOLDER_USER_SELECTED_REMINDER,
        PLACEHOLDER_USER_SELECTED_REPEAT,
        PLACEHOLDER_WORK_END_TIME,
    ]
    .iter()
    .any(|p| settings.ai_prompt.contains(p));

    let has_legacy_placeholders = [
        PLACEHOLDER_NOW_LEGACY,
        PLACEHOLDER_USER_INPUT_LEGACY,
        PLACEHOLDER_SELECTED_FIELDS_LEGACY,
        PLACEHOLDER_OUTPUT_SCHEMA_LEGACY,
    ]
    .iter()
    .any(|p| settings.ai_prompt.contains(p));

    let required_placeholders: &[&str] = if has_legacy_placeholders && !has_new_placeholders {
        &[
            PLACEHOLDER_NOW_LEGACY,
            PLACEHOLDER_USER_INPUT_LEGACY,
            PLACEHOLDER_SELECTED_FIELDS_LEGACY,
            PLACEHOLDER_OUTPUT_SCHEMA_LEGACY,
        ]
    } else {
        &[
            PLACEHOLDER_NOW,
            PLACEHOLDER_USER_INPUT,
            PLACEHOLDER_USER_CURRENT_PROJECT_ID,
            PLACEHOLDER_PROJECT_LIST,
            PLACEHOLDER_OPEN_TASKS,
            PLACEHOLDER_USER_SELECTED_REMINDER,
            PLACEHOLDER_USER_SELECTED_REPEAT,
            PLACEHOLDER_WORK_END_TIME,
        ]
    };

    // User-configurable prompt template. We support placeholders so users can decide where the
    // runtime-injected context lands. If placeholders are missing, we append them to keep the
    // model grounded and the output contract stable.
    let mut template = settings.ai_prompt.trim().to_string();
    let had_placeholder = has_new_placeholders || has_legacy_placeholders;

    let mut missing: Vec<&'static str> = Vec::new();
    for &placeholder in required_placeholders {
        if !template.contains(placeholder) {
            missing.push(placeholder);
            if !template.is_empty() && !template.ends_with('\n') {
                template.push('\n');
            }
            template.push('\n');
            template.push_str(placeholder);
            template.push('\n');
        }
    }

    if !had_placeholder {
        log::warn!(
            "ai_prompt has no placeholders; auto-appending defaults missing={:?}",
            missing
        );
    } else if !missing.is_empty() {
        log::warn!(
            "ai_prompt missing placeholders; auto-appending missing={:?}",
            missing
        );
    }

    let now_string = format_local(now);
    let project_list = build_project_list_block(projects);
    let open_tasks = build_open_tasks_block(tasks, projects);
    let selected_reminder = build_user_selected_reminder_block(input, now);
    let selected_repeat = build_user_selected_repeat_block(input);

    let user = template
        // New placeholders.
        .replace(PLACEHOLDER_NOW, &now_string)
        .replace(PLACEHOLDER_USER_INPUT, input.raw_input.trim())
        .replace(PLACEHOLDER_USER_CURRENT_PROJECT_ID, input.project_id.trim())
        .replace(PLACEHOLDER_PROJECT_LIST, &project_list)
        .replace(PLACEHOLDER_OPEN_TASKS, &open_tasks)
        .replace(PLACEHOLDER_USER_SELECTED_REMINDER, &selected_reminder)
        .replace(PLACEHOLDER_USER_SELECTED_REPEAT, &selected_repeat)
        .replace(PLACEHOLDER_WORK_END_TIME, DEFAULT_WORK_END_TIME)
        // Legacy placeholders.
        .replace(PLACEHOLDER_NOW_LEGACY, &build_now_block(now))
        .replace(
            PLACEHOLDER_USER_INPUT_LEGACY,
            &build_user_input_block(input),
        )
        .replace(
            PLACEHOLDER_SELECTED_FIELDS_LEGACY,
            &build_selected_fields_block(input, &reminder_kind_json, &repeat_json),
        )
        .replace(
            PLACEHOLDER_OUTPUT_SCHEMA_LEGACY,
            build_output_schema_block(),
        );

    (system, user)
}

pub fn parse_plan_from_text(text: &str) -> Result<AiPlan, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("empty ai response".to_string());
    }

    // If the model wraps JSON in fenced blocks, extract the inner payload.
    let mut candidate = trimmed;
    if let Some(stripped) = strip_fenced_code_block(candidate) {
        candidate = stripped;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(candidate) {
        if let Ok(plan) = plan_from_value(value) {
            return Ok(sanitize_plan(plan));
        }
    }

    // Fallback: extract the first {...} region (best-effort).
    if let Some(extracted) = extract_first_json_object(candidate) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(extracted) {
            if let Ok(plan) = plan_from_value(value) {
                return Ok(sanitize_plan(plan));
            }
        }
    }

    Err("failed to parse ai response as json".to_string())
}

fn plan_from_value(value: serde_json::Value) -> Result<AiPlan, String> {
    use serde_json::Value;

    let obj = value
        .as_object()
        .ok_or_else(|| "ai response json must be an object".to_string())?;

    let project_id = obj
        .get("project_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let title = obj
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let due_at = obj
        .get("due_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let important = obj.get("important").and_then(|v| v.as_bool());
    let notes = obj
        .get("notes")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut steps = Vec::<AiStep>::new();
    if let Some(Value::Array(items)) = obj.get("steps") {
        for item in items {
            match item {
                Value::String(title) => steps.push(AiStep {
                    title: title.clone(),
                }),
                Value::Object(map) => {
                    if let Some(Value::String(title)) = map.get("title") {
                        steps.push(AiStep {
                            title: title.clone(),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    let mut tags = Vec::<String>::new();
    if let Some(Value::Array(items)) = obj.get("tags") {
        for item in items {
            if let Some(tag) = item.as_str() {
                tags.push(tag.to_string());
            }
        }
    }

    let sample_tag = obj
        .get("sample_tag")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let reminder = match obj.get("reminder") {
        None | Some(Value::Null) => None,
        Some(Value::Object(map)) => {
            let kind = map.get("kind").and_then(|v| v.as_str()).and_then(|s| {
                match s.trim().to_lowercase().as_str() {
                    "none" => Some(ReminderKind::None),
                    "normal" => Some(ReminderKind::Normal),
                    "forced" => Some(ReminderKind::Forced),
                    _ => None,
                }
            });
            let remind_at = map
                .get("remind_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let forced_dismissed = map.get("forced_dismissed").and_then(|v| v.as_bool());
            Some(AiReminder {
                kind,
                remind_at,
                forced_dismissed,
            })
        }
        _ => None,
    };

    let repeat = match obj.get("repeat") {
        None | Some(Value::Null) => None,
        Some(value) => serde_json::from_value::<RepeatRule>(value.clone()).ok(),
    };

    Ok(AiPlan {
        project_id,
        title,
        due_at,
        important,
        notes,
        steps,
        tags,
        sample_tag,
        reminder,
        repeat,
    })
}

#[cfg(all(feature = "app", not(test)))]
pub async fn plan_with_deepseek(
    settings: &Settings,
    input: &AiPlanRequest,
    projects: &[Project],
    tasks: &[Task],
) -> Result<AiPlan, String> {
    use std::time::Duration;

    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() {
        return Err("missing deepseek api key".to_string());
    }

    let now = chrono::Utc::now().timestamp();
    let (system, user) = build_prompt(settings, input, now, projects, tasks);

    let payload = serde_json::json!({
        "model": "deepseek-chat",
        "temperature": 0.2,
        "max_tokens": 1200,
        "stream": false,
        "messages": [
          { "role": "system", "content": system },
          { "role": "user", "content": user }
        ]
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|err| format!("failed to build http client: {err}"))?;

    let resp = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("deepseek request failed: {err}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|err| format!("failed to read deepseek response: {err}"))?;

    if !status.is_success() {
        return Err(format!("deepseek http {status}: {text}"));
    }

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|err| format!("invalid deepseek json: {err}"))?;

    let content = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim();

    parse_plan_from_text(content)
}

fn sanitize_plan(mut plan: AiPlan) -> AiPlan {
    plan.project_id = plan.project_id.trim().to_string();
    plan.title = plan.title.trim().to_string();

    plan.notes = plan
        .notes
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    plan.sample_tag = plan
        .sample_tag
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Steps: trim + dedupe (keep order) + cap.
    let mut steps: Vec<AiStep> = plan
        .steps
        .into_iter()
        .map(|step| AiStep {
            title: step.title.trim().to_string(),
        })
        .filter(|step| !step.title.is_empty())
        .collect();
    let mut seen = std::collections::HashSet::<String>::new();
    steps.retain(|s| seen.insert(s.title.clone()));
    const MAX_STEPS: usize = 12;
    if steps.len() > MAX_STEPS {
        steps.truncate(MAX_STEPS);
    }
    plan.steps = steps;

    // Tags: trim + dedupe (keep order) + cap.
    let mut tags: Vec<String> = plan
        .tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let mut seen = std::collections::HashSet::<String>::new();
    tags.retain(|t| seen.insert(t.clone()));
    const MAX_TAGS: usize = 16;
    if tags.len() > MAX_TAGS {
        tags.truncate(MAX_TAGS);
    }
    plan.tags = tags;

    if let Some(reminder) = &mut plan.reminder {
        reminder.remind_at = reminder
            .remind_at
            .take()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
    }
    plan
}

fn strip_fenced_code_block(text: &str) -> Option<&str> {
    let mut s = text.trim();
    if !s.starts_with("```") {
        return None;
    }
    // Trim opening fence line.
    if let Some(pos) = s.find('\n') {
        s = &s[pos + 1..];
    } else {
        return None;
    }
    // Trim trailing fence.
    if let Some(end) = s.rfind("```") {
        return Some(s[..end].trim());
    }
    None
}

fn extract_first_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(text[start..=end].trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_supports_legacy_placeholders() {
        let mut settings = Settings::default();
        settings.ai_prompt =
            "CUSTOM\n{{mustdo_user_input}}\n{{mustdo_selected_fields}}\n{{mustdo_output_schema}}"
                .to_string();

        let req = AiPlanRequest {
            raw_input: "买牛奶 #生活".to_string(),
            title: "买牛奶".to_string(),
            project_id: "inbox".to_string(),
            tags: vec!["生活".to_string()],
            due_at: 123,
            important: true,
            repeat: RepeatRule::None,
            reminder_kind: ReminderKind::Normal,
            reminder_offset_minutes: 10,
        };

        let (_system, user) = build_prompt(&settings, &req, 1700000000, &[], &[]);
        assert!(user.contains("CUSTOM"));
        assert!(user.contains("买牛奶 #生活"));
        assert!(user.contains("due_at_unix: 123"));
        assert!(user.contains("important: true"));
        assert!(user.contains("reminder_kind:"));
        assert!(user.contains("repeat:"));
        assert!(user.contains("\"生活\""));
    }

    #[test]
    fn build_prompt_supports_new_placeholders() {
        let mut settings = Settings::default();
        settings.ai_prompt = [
            "X {{Now}}",
            "Y {{UserInput}}",
            "P {{UserCurrentProjectId}}",
            "L {{ProjectList}}",
            "T {{OpenTasks}}",
            "R {{UserSelectedReminder}}",
            "E {{UserSelectedRepeat}}",
            "W {{WorkEndTime}}",
        ]
        .join("\n");

        let req = AiPlanRequest {
            raw_input: "buy milk".to_string(),
            title: "buy milk".to_string(),
            project_id: "inbox".to_string(),
            tags: vec![],
            due_at: 123,
            important: false,
            repeat: RepeatRule::None,
            reminder_kind: ReminderKind::None,
            reminder_offset_minutes: 10,
        };

        let (_system, user) = build_prompt(&settings, &req, 1700000000, &[], &[]);

        // Placeholders should not leak to the final prompt.
        assert!(!user.contains("{{Now}}"));
        assert!(!user.contains("{{UserInput}}"));
        assert!(!user.contains("{{UserCurrentProjectId}}"));
        assert!(!user.contains("{{ProjectList}}"));
        assert!(!user.contains("{{OpenTasks}}"));
        assert!(!user.contains("{{UserSelectedReminder}}"));
        assert!(!user.contains("{{UserSelectedRepeat}}"));
        assert!(!user.contains("{{WorkEndTime}}"));

        assert!(user.contains("buy milk"));
        assert!(user.contains("inbox"));
        assert!(user.contains("[]")); // project list / open tasks default in tests
    }

    #[test]
    fn parse_plan_accepts_legacy_notes_steps_json() {
        let plan = parse_plan_from_text(r#"{"notes":"n","steps":["a","b"]}"#).unwrap();
        assert_eq!(plan.notes.as_deref(), Some("n"));
        assert_eq!(
            plan.steps
                .iter()
                .map(|s| s.title.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }

    #[test]
    fn parse_plan_accepts_fenced_json() {
        let plan =
            parse_plan_from_text("```json\n{\"notes\":\"n\",\"steps\":[{\"title\":\"a\"}]}\n```")
                .unwrap();
        assert_eq!(plan.notes.as_deref(), Some("n"));
        assert_eq!(
            plan.steps
                .iter()
                .map(|s| s.title.as_str())
                .collect::<Vec<_>>(),
            vec!["a"]
        );
    }

    #[test]
    fn parse_plan_dedupes_and_trims_steps() {
        let plan = parse_plan_from_text(r#"{"notes":" n ","steps":[" a ","a",""," b "]}"#).unwrap();
        assert_eq!(plan.notes.as_deref(), Some("n"));
        assert_eq!(
            plan.steps
                .iter()
                .map(|s| s.title.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }
}
