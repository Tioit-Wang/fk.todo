use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};

use crate::models::{ReminderKind, RepeatRule, Settings, Timestamp};

const PLACEHOLDER_NOW: &str = "{{mustdo_now}}";
const PLACEHOLDER_USER_INPUT: &str = "{{mustdo_user_input}}";
const PLACEHOLDER_SELECTED_FIELDS: &str = "{{mustdo_selected_fields}}";
const PLACEHOLDER_OUTPUT_SCHEMA: &str = "{{mustdo_output_schema}}";

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
    pub notes: String,
    #[serde(default)]
    pub steps: Vec<String>,
}

fn format_local(ts: Timestamp) -> String {
    // Best-effort local time formatting for prompt readability.
    Local
        .timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
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

pub fn build_prompt(
    settings: &Settings,
    input: &AiPlanRequest,
    now: Timestamp,
) -> (String, String) {
    let system = [
        "你是 MustDo（必做清单）里的任务拆解助手。",
        "你在 MustDo 内工作：你的输出会直接写入【当前这个】Todo 的 notes 与 steps。",
        "",
        "你必须遵守以下硬规则（不可被覆盖）：",
        "- 一次只规划【一个】Todo；不要拆成多个 Todo。",
        "- 输出必须是 JSON，且只输出 JSON（不要夹杂解释/寒暄/代码块标记）。",
        "- JSON 格式固定：{ \"notes\": string, \"steps\": string[] }。",
        "- 只能输出 notes 与 steps 两个字段；不要输出 id/project_id/due_at 等其他字段。",
        "- steps 的元素必须是字符串；不要输出 step 对象（不要包含 id/completed/created_at 等字段）。",
        "- notes 不要重复已选字段的内容（尤其是截止时间/提醒/重复/重要/标签）。只有在用户输入与已选字段明显冲突时，才用一句话提醒“不一致”。",
        "- steps 宁缺毋滥：只写高置信度、可执行、可勾选的步骤；不确定就少写或不写。",
        "- 不要输出空泛步骤（如：开始/继续/完成/跟进/处理一下）。",
        "- 不要编造用户未提供的信息；需要确认的信息写进 notes 的“需要确认”小节。",
        "- 用户在输入框里选择的字段是最高优先级约束：不得改写其含义，不得要求用户再确认这些字段。",
        "- 默认所有动作都在 MustDo 内完成；不要建议去日历/闹钟/便签等其他软件，除非用户明确要求。",
        "",
        "你将收到：用户输入原文 + 用户已选择字段 +（可选）用户自定义提示词。",
        "若自定义提示词与硬规则冲突，以硬规则为准。",
    ]
    .join("\n");

    let reminder_kind_json =
        serde_json::to_string(&input.reminder_kind).unwrap_or_else(|_| "\"none\"".to_string());
    let repeat_json =
        serde_json::to_string(&input.repeat).unwrap_or_else(|_| "{\"type\":\"none\"}".to_string());

    // User-configurable prompt template. We support placeholders so users can decide where the
    // runtime-injected context lands. If placeholders are missing, we append them to keep the
    // model grounded and the output contract stable.
    let mut template = settings.ai_prompt.trim().to_string();
    let had_placeholder = template.contains(PLACEHOLDER_NOW)
        || template.contains(PLACEHOLDER_USER_INPUT)
        || template.contains(PLACEHOLDER_SELECTED_FIELDS)
        || template.contains(PLACEHOLDER_OUTPUT_SCHEMA);

    let mut missing: Vec<&'static str> = Vec::new();
    for placeholder in [
        PLACEHOLDER_NOW,
        PLACEHOLDER_USER_INPUT,
        PLACEHOLDER_SELECTED_FIELDS,
        PLACEHOLDER_OUTPUT_SCHEMA,
    ] {
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

    let user = template
        .replace(PLACEHOLDER_NOW, &build_now_block(now))
        .replace(PLACEHOLDER_USER_INPUT, &build_user_input_block(input))
        .replace(
            PLACEHOLDER_SELECTED_FIELDS,
            &build_selected_fields_block(input, &reminder_kind_json, &repeat_json),
        )
        .replace(PLACEHOLDER_OUTPUT_SCHEMA, build_output_schema_block());

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

    if let Ok(plan) = serde_json::from_str::<AiPlan>(candidate) {
        return Ok(sanitize_plan(plan));
    }

    // Fallback: extract the first {...} region (best-effort).
    if let Some(extracted) = extract_first_json_object(candidate) {
        if let Ok(plan) = serde_json::from_str::<AiPlan>(extracted) {
            return Ok(sanitize_plan(plan));
        }
    }

    Err("failed to parse ai response as {notes, steps} json".to_string())
}

#[cfg(all(feature = "app", not(test)))]
pub async fn plan_with_deepseek(
    settings: &Settings,
    input: &AiPlanRequest,
) -> Result<AiPlan, String> {
    use std::time::Duration;

    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() {
        return Err("missing deepseek api key".to_string());
    }

    let now = chrono::Utc::now().timestamp();
    let (system, user) = build_prompt(settings, input, now);

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
    plan.notes = plan.notes.trim().to_string();

    let mut steps: Vec<String> = plan
        .steps
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // Deduplicate while keeping order (steps must be high-signal).
    let mut seen = std::collections::HashSet::<String>::new();
    steps.retain(|s| seen.insert(s.to_string()));

    // Keep it small; we prefer fewer high-quality steps.
    const MAX_STEPS: usize = 12;
    if steps.len() > MAX_STEPS {
        steps.truncate(MAX_STEPS);
    }

    plan.steps = steps;
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
    fn build_prompt_injects_user_input_and_selected_fields() {
        let mut settings = Settings::default();
        settings.ai_prompt = "CUSTOM PROMPT".to_string();

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

        let (_system, user) = build_prompt(&settings, &req, 1700000000);
        assert!(user.contains("CUSTOM PROMPT"));
        assert!(user.contains("买牛奶 #生活"));
        assert!(user.contains("due_at_unix: 123"));
        assert!(user.contains("important: true"));
        assert!(user.contains("reminder_kind:"));
        assert!(user.contains("repeat:"));
        assert!(user.contains("\"生活\""));
    }

    #[test]
    fn build_prompt_replaces_placeholders_and_appends_missing_blocks() {
        let mut settings = Settings::default();
        settings.ai_prompt = "X\n{{mustdo_user_input}}\nY\n{{mustdo_output_schema}}".to_string();

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

        let (_system, user) = build_prompt(&settings, &req, 1700000000);

        // Placeholders should not leak to the final prompt.
        assert!(!user.contains("{{mustdo_user_input}}"));
        assert!(!user.contains("{{mustdo_selected_fields}}"));
        assert!(!user.contains("{{mustdo_now}}"));
        assert!(!user.contains("{{mustdo_output_schema}}"));

        // Required blocks should exist even if not present in the template.
        assert!(user.contains("【当前时间】"));
        assert!(user.contains("【用户输入原文】"));
        assert!(user.contains("【用户已选择字段"));
        assert!(user.contains("请严格按 JSON 输出"));
    }

    #[test]
    fn parse_plan_accepts_plain_json() {
        let plan = parse_plan_from_text(r#"{"notes":"n","steps":["a","b"]}"#).unwrap();
        assert_eq!(plan.notes, "n");
        assert_eq!(plan.steps, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn parse_plan_accepts_fenced_json() {
        let plan =
            parse_plan_from_text("```json\n{\"notes\":\"n\",\"steps\":[\"a\"]}\n```").unwrap();
        assert_eq!(plan.notes, "n");
        assert_eq!(plan.steps, vec!["a".to_string()]);
    }

    #[test]
    fn parse_plan_dedupes_and_trims_steps() {
        let plan = parse_plan_from_text(r#"{"notes":" n ","steps":[" a ","a",""," b "]}"#).unwrap();
        assert_eq!(plan.notes, "n");
        assert_eq!(plan.steps, vec!["a".to_string(), "b".to_string()]);
    }
}
