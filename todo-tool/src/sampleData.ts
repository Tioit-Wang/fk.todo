import { buildReminderConfig } from "./reminder";
import type { ReminderKind, RepeatRule, Step, Task } from "./types";

const AI_NOVEL_SAMPLE_TAG = "ai-novel-assistant-v1";
const AI_NOVEL_SEED_MARKER = "seed:ai-novel-assistant-v1";
const AI_NOVEL_TITLE_PREFIX = "AI小说助手 · ";

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function atLocalDayTime(base: Date, offsetDays: number, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function minutesFrom(base: Date, minutes: number): Date {
  const d = new Date(base);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function makeSteps(createdAt: number, items: Array<{ title: string; completed?: boolean }>): Step[] {
  return items.map((item, index) => {
    const completed = Boolean(item.completed);
    const stepCreatedAt = createdAt + index;
    return {
      id: crypto.randomUUID(),
      title: item.title,
      completed,
      created_at: stepCreatedAt,
      completed_at: completed ? stepCreatedAt + 60 : undefined,
    };
  });
}

function makeSeedNotes(extra?: string): string {
  const parts = [
    "示例任务集：AI 小说助手开发计划 (v1)",
    "可用于快速体验四象限与列表视图。",
    AI_NOVEL_SEED_MARKER,
  ];
  if (extra?.trim()) parts.push(extra.trim());
  return parts.join("\n");
}

type SeedReminder = { kind: ReminderKind; offsetMinutes: number };

export function buildAiNovelAssistantSampleTasks(now: Date = new Date()): Task[] {
  const nowSeconds = toSeconds(now);
  let offset = 0;

  const makeTask = ({
    title,
    quadrant,
    dueAtSeconds,
    important = false,
    completed = false,
    reminder,
    repeat = { type: "none" },
    notes,
    stepItems = [],
    tags,
  }: {
    title: string;
    quadrant: 1 | 2 | 3 | 4;
    dueAtSeconds: number;
    important?: boolean;
    completed?: boolean;
    reminder?: SeedReminder;
    repeat?: RepeatRule;
    notes?: string;
    stepItems?: Array<{ title: string; completed?: boolean }>;
    tags?: string[];
  }): Task => {
    const created_at = nowSeconds - offset * 120;
    const updated_at = created_at;
    const completed_at = completed ? Math.min(nowSeconds, created_at + 600) : undefined;
    offset += 1;

    const reminderConfig = reminder
      ? buildReminderConfig(reminder.kind, dueAtSeconds, reminder.offsetMinutes, nowSeconds)
      : buildReminderConfig("none", dueAtSeconds, 0, nowSeconds);

    const resolvedTags = Array.isArray(tags) ? tags : ["示例", "AI小说助手"];

    return {
      id: crypto.randomUUID(),
      title: title.startsWith(AI_NOVEL_TITLE_PREFIX) ? title : `${AI_NOVEL_TITLE_PREFIX}${title}`,
      due_at: dueAtSeconds,
      important,
      completed,
      completed_at,
      created_at,
      updated_at,
      sort_order: 0,
      quadrant,
      notes,
      steps: makeSteps(created_at, stepItems),
      tags: resolvedTags,
      sample_tag: AI_NOVEL_SAMPLE_TAG,
      reminder: reminderConfig,
      repeat,
    };
  };

  const today1800 = toSeconds(atLocalDayTime(now, 0, 18, 0));
  const yesterday1800 = toSeconds(atLocalDayTime(now, -1, 18, 0));
  const twoDaysAgo1800 = toSeconds(atLocalDayTime(now, -2, 18, 0));
  const threeDaysAgo1800 = toSeconds(atLocalDayTime(now, -3, 18, 0));
  const fiveDaysAgo1800 = toSeconds(atLocalDayTime(now, -5, 18, 0));
  const weekAgo1800 = toSeconds(atLocalDayTime(now, -7, 18, 0));

  const tomorrow0900 = toSeconds(atLocalDayTime(now, 1, 9, 0));
  const tomorrow1200 = toSeconds(atLocalDayTime(now, 1, 12, 0));
  const tomorrow1800 = toSeconds(atLocalDayTime(now, 1, 18, 0));

  const plus4Days1800 = toSeconds(atLocalDayTime(now, 4, 18, 0));
  const plus5Days1800 = toSeconds(atLocalDayTime(now, 5, 18, 0));
  const plus7Days1800 = toSeconds(atLocalDayTime(now, 7, 18, 0));
  const plus10Days1800 = toSeconds(atLocalDayTime(now, 10, 18, 0));
  const plus12Days1800 = toSeconds(atLocalDayTime(now, 12, 18, 0));
  const plus14Days1800 = toSeconds(atLocalDayTime(now, 14, 18, 0));

  const plus2Hours = toSeconds(minutesFrom(now, 120));

  return [
    // Q1: 重要且紧急 (Do First)
    makeTask({
      title: "修复『剧情大纲』提示词回归问题",
      quadrant: 1,
      dueAtSeconds: yesterday1800,
      important: true,
      notes: makeSeedNotes("紧急修复：确保生成大纲的结构稳定，避免章节跑题。"),
      stepItems: [
        { title: "复现问题并记录输入/输出", completed: true },
        { title: "定位回归点（提示词/参数/后处理）" },
        { title: "增加最小回归测试样例" },
      ],
    }),
    makeTask({
      title: "定义 MVP 用户故事与验收标准",
      quadrant: 1,
      dueAtSeconds: today1800,
      important: true,
      notes: makeSeedNotes("输出：MVP 里程碑 + 可验收的交付清单。"),
    }),
    makeTask({
      title: "实现『章节生成器』最小闭环",
      quadrant: 1,
      dueAtSeconds: tomorrow1800,
      important: true,
      reminder: { kind: "forced", offsetMinutes: 0 },
      notes: makeSeedNotes("强制提醒：确保关键路径按期落地。"),
      stepItems: [
        { title: "定义输入参数（世界观/角色/上一章摘要）", completed: true },
        { title: "实现生成调用 + 基础错误处理" },
        { title: "保存生成版本号与提示词快照" },
      ],
    }),
    makeTask({
      title: "完成『情节冲突表』数据结构",
      quadrant: 1,
      dueAtSeconds: tomorrow1200,
      important: true,
      reminder: { kind: "normal", offsetMinutes: 60 },
      notes: makeSeedNotes("普通提醒：用于支持后续剧情推进与伏笔管理。"),
    }),
    makeTask({
      title: "已完成: 初版需求清单（四象限）",
      quadrant: 1,
      dueAtSeconds: threeDaysAgo1800,
      important: true,
      completed: true,
      notes: makeSeedNotes("已完成项：用于验证『已完成』视图展示。"),
    }),

    // Q2: 重要不紧急 (Schedule)
    makeTask({
      title: "世界观/设定模板库（JSON Schema）",
      quadrant: 2,
      dueAtSeconds: plus5Days1800,
      important: true,
      notes: makeSeedNotes("目标：让 AI 更稳定地理解世界观约束，减少设定打架。"),
    }),
    makeTask({
      title: "角色设定卡片与关系图结构设计",
      quadrant: 2,
      dueAtSeconds: plus4Days1800,
      important: true,
      notes: makeSeedNotes("输出：角色卡字段 + 关系边类型（亲属/敌对/盟友/债务等）。"),
    }),
    makeTask({
      title: "每周: 用户反馈回收与 Prompt 迭代",
      quadrant: 2,
      dueAtSeconds: plus7Days1800,
      important: true,
      repeat: { type: "weekly", days: [7] },
      notes: makeSeedNotes("循环任务：每周日复盘，形成可追踪的迭代记录。"),
    }),
    makeTask({
      title: "每日(工作日): 写作日志 & 训练样本整理",
      quadrant: 2,
      dueAtSeconds: tomorrow0900,
      important: true,
      repeat: { type: "daily", workday_only: true },
      notes: makeSeedNotes("循环任务：持续收集高质量样本，提升生成一致性。"),
    }),
    makeTask({
      title: "已完成: 明确产品愿景与目标用户",
      quadrant: 2,
      dueAtSeconds: weekAgo1800,
      important: true,
      completed: true,
      notes: makeSeedNotes("已完成项：用于验证『已完成』视图展示。"),
    }),

    // Q3: 紧急不重要 (Delegate)
    makeTask({
      title: "UI 文案走查（按钮/错误提示）",
      quadrant: 3,
      dueAtSeconds: today1800,
      notes: makeSeedNotes("快速提升体验：减少理解成本与误触。"),
    }),
    makeTask({
      title: "同步会议纪要到 Notion",
      quadrant: 3,
      dueAtSeconds: plus2Hours,
      notes: makeSeedNotes("将讨论结果同步到文档，避免信息丢失。"),
    }),
    makeTask({
      title: "收集 10 个竞品交互截图",
      quadrant: 3,
      dueAtSeconds: tomorrow1800,
      notes: makeSeedNotes("关注：分段生成、草稿对比、版本管理等交互。"),
    }),
    makeTask({
      title: "清理 issue 标签 & 里程碑",
      quadrant: 3,
      dueAtSeconds: twoDaysAgo1800,
      notes: makeSeedNotes("逾期项：用于验证『逾期』分组与排序。"),
    }),

    // Q4: 不重要不紧急 (Eliminate)
    makeTask({
      title: "备选: 书名生成器创意池",
      quadrant: 4,
      dueAtSeconds: plus10Days1800,
      notes: makeSeedNotes("发散收集：热梗、类型词、情绪词组合。"),
    }),
    makeTask({
      title: "备选: 角色头像生成方案调研",
      quadrant: 4,
      dueAtSeconds: plus12Days1800,
      notes: makeSeedNotes("探索：本地模型 vs 在线服务，成本与隐私权衡。"),
    }),
    makeTask({
      title: "备选: Logo 草图 3 版",
      quadrant: 4,
      dueAtSeconds: plus14Days1800,
      notes: makeSeedNotes("非关键：用于填充 Q4 样本。"),
    }),
    makeTask({
      title: "已完成: 创建开发计划看板 (TODO/Doing/Done)",
      quadrant: 4,
      dueAtSeconds: fiveDaysAgo1800,
      completed: true,
      notes: makeSeedNotes("已完成项：用于验证『已完成』视图展示。"),
    }),
  ];
}

export function taskIsAiNovelAssistantSample(task: Task): boolean {
  if (task.sample_tag === AI_NOVEL_SAMPLE_TAG) return true;
  if (task.title.startsWith(AI_NOVEL_TITLE_PREFIX)) return true;
  return Boolean(task.notes && task.notes.includes(AI_NOVEL_SEED_MARKER));
}
