// === Constants (ported from QuizCat @quizcat/core/types.js) ===

export const QUIZ_DIFFICULTIES = Object.freeze([
  "easy",
  "medium",
  "hard",
  "insane",
] as const);
export type QuizDifficulty = (typeof QUIZ_DIFFICULTIES)[number];

export const QUESTION_TYPES = Object.freeze([
  "single_choice",
  "true_false",
] as const);
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const OPTION_IDS = Object.freeze(["A", "B", "C", "D"] as const);
export type OptionId = (typeof OPTION_IDS)[number];

export const LIMITS = Object.freeze({
  maxQuestions: 10,
  title: 120,
  stem: 1000,
  optionText: 300,
  explanation: 1500,
  tag: 40,
  tagsPerQuestion: 8,
});

// === Type guards ===

export function isDifficulty(value: unknown): value is QuizDifficulty {
  return (
    typeof value === "string" &&
    (QUIZ_DIFFICULTIES as readonly string[]).includes(value)
  );
}

export function isQuestionType(value: unknown): value is QuestionType {
  return (
    typeof value === "string" &&
    (QUESTION_TYPES as readonly string[]).includes(value)
  );
}

// === Core domain types ===

/** A single option in a single-choice question. */
export interface SingleChoiceOption {
  id: OptionId;
  text: string;
}

/** A single-choice question (2-4 options, labelled A-D). */
export interface SingleChoiceQuestion {
  type: "single_choice";
  id: string;
  stem: string;
  options: SingleChoiceOption[];
  correctOptionId: OptionId;
  explanation?: string;
  tags: string[];
  difficulty?: QuizDifficulty;
}

/** A true/false question. */
export interface TrueFalseQuestion {
  type: "true_false";
  id: string;
  stem: string;
  correctAnswer: boolean;
  explanation?: string;
  tags: string[];
  difficulty?: QuizDifficulty;
}

/** Union of all question types. */
export type Question = SingleChoiceQuestion | TrueFalseQuestion;

/** The complete quiz group — the canonical form after validation. */
export interface QuizGroup {
  id: string;
  title: string;
  topic?: string;
  difficulty?: QuizDifficulty;
  questions: Question[];
}

/**
 * Public-facing question with correct answers stripped.
 * For single-choice: `correctOptionId` is omitted.
 * For true-false: `correctAnswer` is omitted.
 */
export type PublicSingleChoiceQuestion = Omit<
  SingleChoiceQuestion,
  "correctOptionId"
> & { correctOptionId?: never };

export type PublicTrueFalseQuestion = Omit<
  TrueFalseQuestion,
  "correctAnswer"
> & { correctAnswer?: never };

export type PublicQuestion =
  | PublicSingleChoiceQuestion
  | PublicTrueFalseQuestion;

/** Quiz group as displayed to the user (no answers). */
export interface PublicQuizGroup {
  id: string;
  title: string;
  topic?: string;
  difficulty?: QuizDifficulty;
  questions: PublicQuestion[];
}

// === Scoring types ===

/** A single user answer. */
export interface UserAnswer {
  questionId: string;
  answer: string | boolean;
}

/** Result entry for a single question. */
export interface AnswerResult {
  questionId: string;
  isCorrect: boolean;
  userAnswer: string | boolean | undefined;
  correctAnswer: string | boolean | undefined;
  explanation?: string;
  tags: string[];
}

/** Full quiz scoring result. */
export interface QuizResult {
  quizGroupId: string;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  accuracy: number;
  answers: AnswerResult[];
  weakTags: string[];
}

// === Next-group prompt types ===

/** Input needed to generate a next-group prompt. */
export interface NextGroupRequestContext {
  quizGroupId: string;
  title: string;
  topic?: string;
  difficulty?: QuizDifficulty;
  score: string;
  accuracy: string;
  weakTags: string[];
  wrongQuestionIds: string[];
}
