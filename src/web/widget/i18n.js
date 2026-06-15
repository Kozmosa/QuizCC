const MESSAGES = {
  en: {
    localeLabel: "English",
    summary: "Summary",
    waiting: "QuizCat is waiting for a quiz group.",
    submit: "Submit",
    previous: "Previous",
    next: "Next",
    finish: "Finish",
    correct: "Correct",
    wrong: "Not quite",
    correctAnswer: "Correct answer",
    summaryTitle: "QuizCat Summary",
    score: "Score",
    accuracy: "Accuracy",
    mistakes: "Mistakes",
    weakAreas: "Weak areas",
    none: "None",
    perfectRun: "Perfect run.",
    noMissedQuestions: "No missed questions in this group.",
    reviewAgain: "Review Again",
    nextGroup: "Next Group",
    yourAnswer: "Your answer",
    trueLabel: "True",
    falseLabel: "False",
    noAnswer: "No answer",
    promptIntro: "Please generate the next QuizCat group and call render_quiz_group again.",
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
      "Requirements: keep the same topic and difficulty, emphasize weak areas, use only single_choice and true_false, and keep the same question count."
  },
  "zh-CN": {
    localeLabel: "中文",
    summary: "总结",
    waiting: "QuizCat 正在等待题组。",
    submit: "提交",
    previous: "上一题",
    next: "下一题",
    finish: "完成",
    correct: "答对了",
    wrong: "还不对",
    correctAnswer: "正确答案",
    summaryTitle: "QuizCat 总结",
    score: "得分",
    accuracy: "正确率",
    mistakes: "错题",
    weakAreas: "薄弱点",
    none: "暂无",
    perfectRun: "全对。",
    noMissedQuestions: "本组没有错题。",
    reviewAgain: "重新回顾",
    nextGroup: "下一组",
    yourAnswer: "你的答案",
    trueLabel: "正确",
    falseLabel: "错误",
    noAnswer: "未作答",
    promptIntro: "请继续生成下一组 QuizCat 题目，并再次调用 render_quiz_group。",
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
      "要求：保持相同主题和难度，增加对薄弱点的考查，题型只使用 single_choice 和 true_false，题目数量与上一组一致。"
  },
  ja: {
    localeLabel: "日本語",
    summary: "結果",
    waiting: "QuizCat は問題セットを待っています。",
    submit: "送信",
    previous: "前へ",
    next: "次へ",
    finish: "完了",
    correct: "正解",
    wrong: "不正解",
    correctAnswer: "正しい答え",
    summaryTitle: "QuizCat 結果",
    score: "スコア",
    accuracy: "正答率",
    mistakes: "間違えた問題",
    weakAreas: "弱点",
    none: "なし",
    perfectRun: "全問正解です。",
    noMissedQuestions: "このセットで間違えた問題はありません。",
    reviewAgain: "もう一度確認",
    nextGroup: "次のセット",
    yourAnswer: "あなたの答え",
    trueLabel: "正しい",
    falseLabel: "誤り",
    noAnswer: "未回答",
    promptIntro: "次の QuizCat 問題セットを生成し、もう一度 render_quiz_group を呼び出してください。",
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
      "条件：同じトピックと難易度を維持し、弱点を重点的に扱い、single_choice と true_false のみを使い、問題数も前回と同じにしてください。"
  }
};

export function normalizeLocale(locale) {
  if (!locale || typeof locale !== "string") return undefined;
  const value = locale.trim().replace("_", "-").toLowerCase();
  if (value === "zh" || value.startsWith("zh-")) return "zh-CN";
  if (value === "ja" || value.startsWith("ja-")) return "ja";
  if (value === "en" || value.startsWith("en-")) return "en";
  return undefined;
}

export function detectLocale() {
  return (
    normalizeLocale(window.openai?.locale) ||
    normalizeLocale(navigator.language) ||
    "en"
  );
}

export function getMessages(locale) {
  return MESSAGES[normalizeLocale(locale) || "en"];
}

export function createLocalizedNextGroupPrompt({ quizGroup, result, locale }) {
  const messages = getMessages(locale);
  const weakTags = result.weakTags.length ? result.weakTags.join(", ") : messages.promptNoWeakAreas;
  const wrongQuestionIds =
    result.answers.filter((answer) => !answer.isCorrect).map((answer) => answer.questionId).join(", ") ||
    messages.promptNoWeakAreas;

  const previousQuestions = Array.isArray(quizGroup.questions)
    ? quizGroup.questions
        .map((question, index) => {
          if (!question?.stem) return "";
          return `${index + 1}. ${question.stem}`;
        })
        .filter(Boolean)
    : [];

  const uniqueRequirement =
    normalizeLocale(locale) === "zh-CN"
      ? [
          "重要：这必须是一组全新的 QuizCat 题目。",
          "不要复用上一组的题组 ID。",
          "不要重复上一组的任何题干、选项组合或解释文本。",
          "可以保持相同知识点，但必须换新的考查角度和表述。",
          "生成完成后必须再次调用 render_quiz_group，而不是只回复文字。"
        ].join("\n")
      : [
          "Important: this must be a brand-new QuizCat group.",
          "Do not reuse the previous quiz group ID.",
          "Do not repeat any previous stems, option sets, or explanation text.",
          "Keep the same knowledge area, but use new angles and wording.",
          "After generating it, call render_quiz_group again instead of only replying with text."
        ].join("\n");

  return [
    messages.promptIntro,
    uniqueRequirement,
    `${messages.promptQuizGroupId}: ${quizGroup.id}`,
    `${messages.promptPreviousTitle}: ${quizGroup.title}`,
    `${messages.promptTopic}: ${quizGroup.topic || messages.promptUnspecified}`,
    `${messages.promptDifficulty}: ${quizGroup.difficulty || "medium"}`,
    `${messages.promptScore}: ${result.correctCount} / ${result.totalQuestions}`,
    `${messages.promptAccuracy}: ${result.accuracy}%`,
    `${messages.promptWeakAreas}: ${weakTags}`,
    `${messages.promptWrongQuestions}: ${wrongQuestionIds}`,
    ...(previousQuestions.length
      ? ["", "Previous question stems:", previousQuestions.join("\n")]
      : []),
    "",
    messages.promptRequirements
  ].join("\n");
}