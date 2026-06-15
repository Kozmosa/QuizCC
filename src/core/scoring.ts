import type {
  Question,
  QuizGroup,
  UserAnswer,
  AnswerResult,
  QuizResult,
} from "./types.js";

// === Scoring ===

/**
 * Score a quiz group against user answers.
 * Returns a full QuizResult with per-question details and weak area analysis.
 */
export function scoreQuiz(
  quizGroup: QuizGroup,
  userAnswers: UserAnswer[]
): QuizResult {
  const answers: AnswerResult[] = quizGroup.questions.map((question) => {
    const userAnswer = userAnswers.find(
      (a) => a.questionId === question.id
    );
    const correct = getCorrectAnswer(question);
    const isCorrect = sameAnswer(userAnswer?.answer, correct);

    return {
      questionId: question.id,
      isCorrect,
      userAnswer: userAnswer?.answer,
      correctAnswer: correct,
      explanation: question.explanation,
      tags: question.tags ?? [],
    };
  });

  const correctCount = answers.filter((a) => a.isCorrect).length;
  const totalQuestions = answers.length;
  const weakTags = collectWeakTags(answers);

  return {
    quizGroupId: quizGroup.id,
    totalQuestions,
    correctCount,
    wrongCount: totalQuestions - correctCount,
    accuracy:
      totalQuestions > 0
        ? Math.round((correctCount / totalQuestions) * 1000) / 10
        : 0,
    answers,
    weakTags,
  };
}

/**
 * Extract the correct answer from a question.
 * - single_choice → the correct option ID (A, B, C, D)
 * - true_false → the boolean value
 */
export function getCorrectAnswer(
  question: Question
): string | boolean | undefined {
  if (question.type === "single_choice") return question.correctOptionId;
  if (question.type === "true_false") return question.correctAnswer;
  return undefined;
}

// === Internal helpers ===

/** Compare a user answer to the correct answer. Normalises booleans to "true"/"false". */
function sameAnswer(
  user: string | boolean | undefined,
  correct: string | boolean | undefined
): boolean {
  if (user === undefined || correct === undefined) return false;
  // Normalise booleans to strings for comparison
  const u = typeof user === "boolean" ? String(user) : user.trim();
  const c =
    typeof correct === "boolean" ? String(correct) : correct.trim();
  return u.toLowerCase() === c.toLowerCase();
}

/** Collect tags from wrong answers, deduplicated and sorted by frequency (descending). */
function collectWeakTags(answers: AnswerResult[]): string[] {
  const tagCounts = new Map<string, number>();
  for (const a of answers) {
    if (a.isCorrect) continue;
    for (const tag of a.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}
