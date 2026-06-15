import type { QuizGroup, QuizResult } from "./types.js";

// === i18n Messages (ported from QuizCat widget i18n.js) ===

export const MESSAGES: Record<string, Record<string, string>> = {
  en: {
    localeLabel: "English",
    summary: "Summary",
    waiting: "QuizCC is waiting for a quiz group.",
    submit: "Submit",
    previous: "Previous",
    next: "Next",
    finish: "Finish",
    correct: "Correct!",
    wrong: "Not quite",
    correctAnswer: "Correct answer",
    summaryTitle: "Quiz Complete",
    score: "Score",
    accuracy: "Accuracy",
    mistakes: "Mistakes",
    weakAreas: "Weak areas",
    none: "None",
    perfectRun: "Perfect run!",
    noMissedQuestions: "No missed questions in this group.",
    yourAnswer: "Your answer",
    trueLabel: "True",
    falseLabel: "False",
    noAnswer: "No answer",
    promptIntro:
      "Please generate the next QuizCC quiz group and call start_quiz again.",
    promptQuizGroupId: "Quiz group ID",
    promptPreviousTitle: "Previous title",
    promptTopic: "Topic",
    promptDifficulty: "Difficulty",
    promptScore: "Score",
    promptAccuracy: "Accuracy",
    promptWeakAreas: "Weak areas",
    promptWrongQuestions: "Wrong questions",
    promptUnspecified: "unspecified",
    promptNoWeakAreas: "none",
    promptRequirements:
      "Requirements: keep the same topic and difficulty, emphasize weak areas, use only single_choice and true_false, and keep the same question count. Do NOT reuse any previous question stems, options, or IDs.",
  },
  "zh-CN": {
    localeLabel: "中文",
    summary: "总结",
    waiting: "QuizCC 正在等待题组。",
    submit: "提交",
    previous: "上一题",
    next: "下一题",
    finish: "完成",
    correct: "答对了",
    wrong: "还不对",
    correctAnswer: "正确答案",
    summaryTitle: "测验完成",
    score: "得分",
    accuracy: "正确率",
    mistakes: "错题",
    weakAreas: "薄弱点",
    none: "暂无",
    perfectRun: "全对！",
    noMissedQuestions: "本组没有错题。",
    yourAnswer: "你的答案",
    trueLabel: "正确",
    falseLabel: "错误",
    noAnswer: "未作答",
    promptIntro:
      "请继续生成下一组 QuizCC 题目，并再次调用 start_quiz。",
    promptQuizGroupId: "题组 ID",
    promptPreviousTitle: "上一组标题",
    promptTopic: "主题",
    promptDifficulty: "难度",
    promptScore: "得分",
    promptAccuracy: "正确率",
    promptWeakAreas: "薄弱点",
    promptWrongQuestions: "错题",
    promptUnspecified: "未指定",
    promptNoWeakAreas: "暂无",
    promptRequirements:
      "要求：保持相同主题和难度，增加对薄弱点的考查，题型只使用 single_choice 和 true_false，题目数量与上一组一致。不要复用任何之前的题干、选项或 ID。",
  },
  ja: {
    localeLabel: "日本語",
    summary: "結果",
    waiting: "QuizCC は問題セットを待っています。",
    submit: "送信",
    previous: "前へ",
    next: "次へ",
    finish: "完了",
    correct: "正解！",
    wrong: "不正解",
    correctAnswer: "正しい答え",
    summaryTitle: "クイズ完了",
    score: "スコア",
    accuracy: "正答率",
    mistakes: "間違えた問題",
    weakAreas: "弱点",
    none: "なし",
    perfectRun: "全問正解です！",
    noMissedQuestions: "このセットで間違えた問題はありません。",
    yourAnswer: "あなたの答え",
    trueLabel: "正しい",
    falseLabel: "誤り",
    noAnswer: "未回答",
    promptIntro:
      "次の QuizCC 問題セットを生成し、もう一度 start_quiz を呼び出してください。",
    promptQuizGroupId: "問題セット ID",
    promptPreviousTitle: "前回のタイトル",
    promptTopic: "トピック",
    promptDifficulty: "難易度",
    promptScore: "スコア",
    promptAccuracy: "正答率",
    promptWeakAreas: "弱点",
    promptWrongQuestions: "間違えた問題",
    promptUnspecified: "未指定",
    promptNoWeakAreas: "なし",
    promptRequirements:
      "条件：同じトピックと難易度を維持し、弱点を重点的に扱い、single_choice と true_false のみを使い、問題数も前回と同じにしてください。以前の質問文、選択肢、ID を再利用しないでください。",
  },
};

// === Locale helpers (ported from widget i18n.js) ===

export function normalizeLocale(locale: string | undefined): string | undefined {
  if (!locale || typeof locale !== "string") return undefined;
  const value = locale.trim().replace("_", "-").toLowerCase();
  if (value === "zh" || value.startsWith("zh-")) return "zh-CN";
  if (value === "ja" || value.startsWith("ja-")) return "ja";
  if (value === "en" || value.startsWith("en-")) return "en";
  return undefined;
}

export function getMessages(locale?: string): Record<string, string> {
  const key = normalizeLocale(locale) || "en";
  return MESSAGES[key] ?? MESSAGES.en!;
}

// === Next-group prompt generation ===

/**
 * Generate a Chinese prompt instructing the LLM to create the next quiz group.
 * This is the original QuizCat prompt format (Chinese-only).
 */
export function createNextGroupPrompt(params: {
  quizGroup: QuizGroup;
  result: QuizResult;
}): string {
  const { quizGroup, result } = params;
  const weakTags =
    result.weakTags.length > 0 ? result.weakTags.join(", ") : "none";
  const wrongQuestionIds =
    result.answers
      .filter((a) => !a.isCorrect)
      .map((a) => a.questionId)
      .join(", ") || "none";

  return [
    "请继续生成下一组 QuizCC 题目，并再次调用 start_quiz。",
    `题组 ID：${quizGroup.id}`,
    `上一组标题：${quizGroup.title}`,
    `主题：${quizGroup.topic || "未指定"}`,
    `难度：${quizGroup.difficulty || "medium"}`,
    `得分：${result.correctCount} / ${result.totalQuestions}`,
    `正确率：${result.accuracy}%`,
    `薄弱点：${weakTags}`,
    `错题：${wrongQuestionIds}`,
    "要求：保持相同主题和难度，增加对薄弱点的考查，题型只使用 single_choice 和 true_false，题目数量与上一组一致。不要复用任何之前的题干、选项或 ID。",
  ].join("\n");
}

/**
 * Generate a localized next-group prompt based on locale.
 * Supports English (en), Simplified Chinese (zh-CN), and Japanese (ja).
 */
export function createLocalizedNextGroupPrompt(params: {
  quizGroup: QuizGroup;
  result: QuizResult;
  locale?: string;
}): string {
  const { quizGroup, result } = params;
  const messages = getMessages(params.locale);
  const weakTags = result.weakTags.length
    ? result.weakTags.join(", ")
    : messages.promptNoWeakAreas ?? "none";
  const wrongQuestionIds =
    result.answers
      .filter((a) => !a.isCorrect)
      .map((a) => a.questionId)
      .join(", ") || (messages.promptNoWeakAreas ?? "none");

  const previousQuestions = quizGroup.questions
    .map((q, i) => (q.stem ? `${i + 1}. ${q.stem}` : ""))
    .filter(Boolean);

  const uniqueRequirement =
    normalizeLocale(params.locale) === "zh-CN"
      ? [
          "重要：这必须是一组全新的 QuizCC 题目。",
          "不要复用上一组的题组 ID。",
          "不要重复上一组的任何题干、选项组合或解释文本。",
          "可以保持相同知识点，但必须换新的考查角度和表述。",
          "生成完成后必须再次调用 start_quiz，而不是只回复文字。",
        ].join("\n")
      : [
          "Important: this must be a brand-new QuizCC quiz group.",
          "Do not reuse the previous quiz group ID.",
          "Do not repeat any previous stems, option sets, or explanation text.",
          "Keep the same knowledge area, but use new angles and wording.",
          "After generating it, call start_quiz again instead of only replying with text.",
        ].join("\n");

  return [
    messages.promptIntro ?? "",
    uniqueRequirement,
    `${messages.promptQuizGroupId ?? "Quiz group ID"}: ${quizGroup.id}`,
    `${messages.promptPreviousTitle ?? "Previous title"}: ${quizGroup.title}`,
    `${messages.promptTopic ?? "Topic"}: ${quizGroup.topic || (messages.promptUnspecified ?? "unspecified")}`,
    `${messages.promptDifficulty ?? "Difficulty"}: ${quizGroup.difficulty || "medium"}`,
    `${messages.promptScore ?? "Score"}: ${result.correctCount} / ${result.totalQuestions}`,
    `${messages.promptAccuracy ?? "Accuracy"}: ${result.accuracy}%`,
    `${messages.promptWeakAreas ?? "Weak areas"}: ${weakTags}`,
    `${messages.promptWrongQuestions ?? "Wrong questions"}: ${wrongQuestionIds}`,
    ...(previousQuestions.length
      ? ["", "Previous question stems:", previousQuestions.join("\n")]
      : []),
    "",
    messages.promptRequirements ?? "",
  ].join("\n");
}
