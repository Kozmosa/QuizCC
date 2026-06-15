import { normalizeQuizGroup, publicQuizGroup } from "../core/validation.js";
import { scoreQuiz, getCorrectAnswer } from "../core/scoring.js";
import { createLocalizedNextGroupPrompt } from "../core/next-group.js";
import {
  createSession,
  loadSession,
  saveSession,
  deleteSession,
  type QuizSession,
} from "../state/session-state.js";
import type { Question, QuizGroup, UserAnswer } from "../core/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// === Answer normalization ===

/**
 * Normalize user input into a canonical answer form.
 * - "A", "a", "A)", "Option A" → "A"
 * - "True", "true", "TRUE", "yes", "y" → "true"
 * - "False", "false", "FALSE", "no", "n" → "false"
 */
function normalizeAnswer(raw: string, questionType: string): string {
  const trimmed = raw.trim();

  if (questionType === "true_false") {
    const lower = trimmed.toLowerCase();
    if (["true", "t", "yes", "y", "1"].includes(lower)) return "true";
    if (["false", "f", "no", "n", "0"].includes(lower)) return "false";
    return lower; // return as-is for scoring (will be wrong)
  }

  // single_choice: extract first A-D letter
  const match = trimmed.match(/^[a-dA-D]/);
  if (match) return match[0].toUpperCase();
  return trimmed; // return as-is for scoring
}

// === Markdown formatters ===

function formatQuestionAsMarkdown(
  question: Question,
  index: number,
  total: number,
  title: string,
  difficulty?: string
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  if (difficulty) {
    lines.push(`**Difficulty:** ${difficulty} | **Question ${index + 1}/${total}**`);
  } else {
    lines.push(`**Question ${index + 1}/${total}**`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`## Q${index + 1}: ${question.stem}`);
  lines.push("");

  if (question.type === "single_choice") {
    for (const opt of question.options) {
      lines.push(`${opt.id}) ${opt.text}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("Type **A**, **B**, **C**, or **D** to answer.");
  } else {
    lines.push("---");
    lines.push("");
    lines.push("Type **True** or **False** to answer.");
  }

  return lines.join("\n");
}

function formatCorrectFeedback(
  question: Question,
  userAnswer: string
): string {
  const correct = getCorrectAnswer(question);
  const correctText = formatAnswerText(question, correct);

  const lines: string[] = [];
  lines.push(`✅ **Correct!** The answer is ${correctText}.`);
  if (question.explanation) {
    lines.push("");
    lines.push(`> ${question.explanation}`);
  }
  return lines.join("\n");
}

function formatWrongFeedback(
  question: Question,
  userAnswer: string
): string {
  const correct = getCorrectAnswer(question);
  const correctText = formatAnswerText(question, correct);
  const userText = formatAnswerText(question, userAnswer);

  const lines: string[] = [];
  lines.push(
    `❌ **Not quite.** Your answer: ${userText}. The correct answer is ${correctText}.`
  );
  if (question.explanation) {
    lines.push("");
    lines.push(`> ${question.explanation}`);
  }
  return lines.join("\n");
}

function formatSummaryMarkdown(
  quizGroup: QuizGroup,
  session: QuizSession
): string {
  const result = scoreQuiz(quizGroup, session.answers);
  const mistakes = result.answers.filter((a) => !a.isCorrect);

  const lines: string[] = [];
  lines.push(`# Quiz Complete: ${quizGroup.title}`);
  lines.push("");

  lines.push(`**Score:** ${result.correctCount}/${result.totalQuestions} (${result.accuracy}%)`);
  lines.push("");

  if (result.weakTags.length > 0) {
    lines.push(`**Weak Areas:** ${result.weakTags.join(", ")}`);
  } else {
    lines.push("**Weak Areas:** None — great job!");
  }
  lines.push("");

  if (mistakes.length > 0) {
    lines.push("## Mistakes");
    lines.push("");
    for (const m of mistakes) {
      const q = quizGroup.questions.find((q) => q.id === m.questionId);
      const userText = formatAnswerText(q, m.userAnswer);
      const correctText = formatAnswerText(q, m.correctAnswer);
      lines.push(
        `- **Q${q ? `: ${q.stem}` : m.questionId}**`
      );
      lines.push(`  Your answer: ${userText}. Correct: ${correctText}`);
      if (m.explanation) {
        lines.push(`  > ${m.explanation}`);
      }
      lines.push("");
    }
  } else {
    lines.push("🎉 **Perfect run!** No missed questions in this group.");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "Would you like another quiz? I can generate a new one focusing on your weak areas."
  );

  return lines.join("\n");
}

function formatAnswerText(
  question: Question | undefined,
  answer: string | boolean | undefined
): string {
  if (answer === undefined || answer === null) return "N/A";
  if (question?.type === "single_choice" && typeof answer === "string") {
    const opt = question.options.find(
      (o) => o.id === answer.toUpperCase()
    );
    return opt
      ? `${answer.toUpperCase()}) ${opt.text}`
      : answer.toUpperCase();
  }
  if (typeof answer === "boolean") return answer ? "True" : "False";
  if (answer === "true") return "True";
  if (answer === "false") return "False";
  return String(answer);
}

// === Tool handlers ===

export async function handleStartQuiz(
  args: unknown
): Promise<CallToolResult> {
  const input = args as { quizGroup: unknown };
  const quizGroup = normalizeQuizGroup(input.quizGroup);

  // Create session with full quiz group (includes answers)
  const session = await createSession(quizGroup);
  const firstQuestion = quizGroup.questions[0]!;

  const markdown = formatQuestionAsMarkdown(
    firstQuestion,
    0,
    quizGroup.questions.length,
    quizGroup.title,
    quizGroup.difficulty
  );

  return {
    content: [{ type: "text", text: markdown }],
    structuredContent: {
      sessionId: session.sessionId,
      quizGroupId: quizGroup.id,
      title: quizGroup.title,
      topic: quizGroup.topic,
      difficulty: quizGroup.difficulty,
      questionType: firstQuestion.type,
      currentQuestion: 1,
      totalQuestions: quizGroup.questions.length,
    },
    _meta: {
      sessionId: session.sessionId,
      quizGroup,
      currentQuestionIndex: 0,
    },
  };
}

export async function handleSubmitAnswer(
  args: unknown
): Promise<CallToolResult> {
  const input = args as { sessionId: string; answer: string };
  const session = await loadSession(input.sessionId);

  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: "⚠️ **Session not found.** The quiz session may have expired. Please start a new quiz with `/quiz [topic]`.",
        },
      ],
      isError: true,
    };
  }

  const currentQuestion =
    session.quizGroup.questions[session.currentQuestionIndex];
  if (!currentQuestion) {
    return {
      content: [
        {
          type: "text",
          text: "⚠️ **Invalid quiz state.** No question at the current index. Please start a new quiz.",
        },
      ],
      isError: true,
    };
  }

  const normalizedAnswer = normalizeAnswer(
    input.answer,
    currentQuestion.type
  );

  // Record the answer
  const userAnswer: UserAnswer = {
    questionId: currentQuestion.id,
    answer: normalizedAnswer,
  };
  session.answers.push(userAnswer);

  // Score this question
  const correct = getCorrectAnswer(currentQuestion);
  const isCorrect =
    normalizedAnswer.toLowerCase() ===
    (typeof correct === "boolean"
      ? String(correct)
      : correct?.toLowerCase());

  // Format feedback
  const feedback = isCorrect
    ? formatCorrectFeedback(currentQuestion, normalizedAnswer)
    : formatWrongFeedback(currentQuestion, normalizedAnswer);

  // Advance to next question
  session.currentQuestionIndex++;
  const isFinished =
    session.currentQuestionIndex >= session.quizGroup.questions.length;

  if (isFinished) {
    // Generate final summary
    const summary = formatSummaryMarkdown(session.quizGroup, session);
    const result = scoreQuiz(session.quizGroup, session.answers);
    const mistakes = result.answers
      .filter((a) => !a.isCorrect)
      .map((a) => {
        const q = session.quizGroup.questions.find(
          (q) => q.id === a.questionId
        );
        return {
          questionId: a.questionId,
          userAnswer: String(a.userAnswer ?? ""),
          correctAnswer: String(a.correctAnswer ?? ""),
          stem: q?.stem ?? a.questionId,
          explanation: a.explanation,
        };
      });

    // Clean up session
    await deleteSession(session.sessionId);

    return {
      content: [
        { type: "text", text: feedback },
        { type: "text", text: "" },
        { type: "text", text: summary },
      ],
      structuredContent: {
        correct: isCorrect,
        correctAnswer: formatAnswerText(currentQuestion, correct),
        explanation: currentQuestion.explanation,
        finished: true,
        score: {
          totalQuestions: result.totalQuestions,
          correctCount: result.correctCount,
          wrongCount: result.wrongCount,
          accuracy: result.accuracy,
        },
        weakTags: result.weakTags,
        mistakes,
      },
      _meta: {
        quizGroup: session.quizGroup,
        result,
      },
    };
  }

  // Save updated session
  await saveSession(session);

  // Format next question
  const nextQuestion =
    session.quizGroup.questions[session.currentQuestionIndex]!;
  const nextMarkdown = formatQuestionAsMarkdown(
    nextQuestion,
    session.currentQuestionIndex,
    session.quizGroup.questions.length,
    session.quizGroup.title,
    session.quizGroup.difficulty
  );

  return {
    content: [
      { type: "text", text: feedback },
      { type: "text", text: "" },
      { type: "text", text: "---" },
      { type: "text", text: "" },
      { type: "text", text: nextMarkdown },
    ],
    structuredContent: {
      correct: isCorrect,
      correctAnswer: formatAnswerText(currentQuestion, correct),
      explanation: currentQuestion.explanation,
      finished: false,
      currentQuestion: session.currentQuestionIndex + 1,
      totalQuestions: session.quizGroup.questions.length,
      remainingQuestions:
        session.quizGroup.questions.length - session.currentQuestionIndex,
      questionType: nextQuestion.type,
    },
    _meta: {
      sessionId: session.sessionId,
      quizGroup: session.quizGroup,
      currentQuestionIndex: session.currentQuestionIndex,
    },
  };
}

export async function handleGetQuizState(
  args: unknown
): Promise<CallToolResult> {
  const input = args as { sessionId: string };
  const session = await loadSession(input.sessionId);

  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: "No active quiz session found. Start a new quiz with `/quiz [topic]`.",
        },
      ],
      isError: true,
    };
  }

  const current = session.currentQuestionIndex;
  const total = session.quizGroup.questions.length;
  const answered = session.answers.length;

  return {
    content: [
      {
        type: "text",
        text: [
          `**Quiz:** ${session.quizGroup.title}`,
          `**Progress:** ${current}/${total} questions`,
          `**Answered:** ${answered} (${answered - current > 0 ? "including advancing" : "current"})`,
          `**Difficulty:** ${session.quizGroup.difficulty || "medium"}`,
          `**Session:** ${session.sessionId}`,
        ].join("\n"),
      },
    ],
    structuredContent: {
      sessionId: session.sessionId,
      quizGroupId: session.quizGroup.id,
      title: session.quizGroup.title,
      currentQuestion: current + 1,
      totalQuestions: total,
      answeredCount: answered,
    },
  };
}

export async function handleGetNextGroupPrompt(
  args: unknown
): Promise<CallToolResult> {
  const input = args as { sessionId: string; locale?: string };
  const session = await loadSession(input.sessionId);

  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: "No active quiz session found.",
        },
      ],
      isError: true,
    };
  }

  const result = scoreQuiz(session.quizGroup, session.answers);
  const prompt = createLocalizedNextGroupPrompt({
    quizGroup: session.quizGroup,
    result,
    locale: input.locale,
  });

  return {
    content: [
      {
        type: "text",
        text: prompt,
      },
    ],
    _meta: {
      prompt,
      quizGroup: session.quizGroup,
      result,
    },
  };
}
