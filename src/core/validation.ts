import {
  LIMITS,
  OPTION_IDS,
  isDifficulty,
  isQuestionType,
  type OptionId,
  type PublicQuizGroup,
  type PublicQuestion,
  type Question,
  type QuizGroup,
} from "./types.js";

// === Error class ===

export class QuizValidationError extends Error {
  issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "QuizValidationError";
    this.issues = issues;
  }
}

// === ID generation ===

export function createQuizGroupId(prefix: string = "quizcc"): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

// === Normalization ===

/**
 * Validate and normalize raw quiz input into a well-formed QuizGroup.
 * Throws QuizValidationError if any field is invalid.
 */
export function normalizeQuizGroup(
  input: unknown,
  options?: { id?: string }
): QuizGroup {
  const issues: string[] = [];
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const title =
    normalizeText(source.title, "title", LIMITS.title, issues) ||
    "QuizCC Quiz";
  const topic = optionalText(source.topic, "topic", LIMITS.title, issues);
  const difficulty = normalizeDifficulty(
    source.difficulty,
    issues,
    "difficulty"
  );
  const rawQuestions = Array.isArray(source.questions) ? source.questions : [];

  if (!Array.isArray(source.questions)) {
    issues.push("questions must be an array");
  }
  if (rawQuestions.length === 0) {
    issues.push("questions must contain at least 1 item");
  }
  if (rawQuestions.length > LIMITS.maxQuestions) {
    issues.push(
      `questions must contain at most ${LIMITS.maxQuestions} items`
    );
  }

  const questions: Question[] = rawQuestions
    .slice(0, LIMITS.maxQuestions)
    .map((q: unknown, index: number) => normalizeQuestion(q, index, issues));

  if (issues.length > 0) {
    throw new QuizValidationError("Invalid QuizCC quiz group", issues);
  }

  return {
    id:
      optionalText(source.id, "id", 120, issues) ||
      options?.id ||
      createQuizGroupId(),
    title,
    ...(topic ? { topic } : {}),
    ...(difficulty ? { difficulty } : {}),
    questions,
  };
}

/**
 * Strip correct answers from a quiz group for public display.
 * Mirrors QuizCat's `publicQuizGroup()`.
 */
export function publicQuizGroup(quizGroup: QuizGroup): PublicQuizGroup {
  return {
    id: quizGroup.id,
    title: quizGroup.title,
    topic: quizGroup.topic,
    difficulty: quizGroup.difficulty,
    questions: quizGroup.questions.map((question) => {
      // Base fields shared by both question types.
      const base: Omit<
        PublicQuestion,
        "options" | "correctOptionId" | "correctAnswer"
      > = {
        type: question.type,
        id: question.id,
        stem: question.stem,
        tags: question.tags,
        difficulty: question.difficulty,
      } as Omit<PublicQuestion, "options" | "correctOptionId" | "correctAnswer">;

      if (question.type === "single_choice") {
        return {
          ...base,
          type: "single_choice" as const,
          options: question.options,
        };
      }
      return {
        ...base,
        type: "true_false" as const,
      };
    }),
  };
}

// === Internal helpers ===

/** Shared base fields for any question type. */
interface QuestionBase {
  id: string;
  stem: string;
  explanation: string | undefined;
  tags: string[];
  difficulty: QuizGroup["difficulty"];
}

function normalizeQuestion(
  rawQuestion: unknown,
  index: number,
  issues: string[]
): Question {
  const q =
    rawQuestion && typeof rawQuestion === "object"
      ? (rawQuestion as Record<string, unknown>)
      : {};
  const path = `questions[${index}]`;
  const type = q.type;

  if (!isQuestionType(type)) {
    issues.push(`${path}.type must be single_choice or true_false`);
  }

  const base: QuestionBase = {
    id:
      optionalText(q.id, `${path}.id`, 120, issues) || `q${index + 1}`,
    stem: normalizeText(q.stem, `${path}.stem`, LIMITS.stem, issues),
    explanation: optionalText(
      q.explanation,
      `${path}.explanation`,
      LIMITS.explanation,
      issues
    ),
    tags: normalizeTags(q.tags, `${path}.tags`, issues),
    difficulty: normalizeDifficulty(
      q.difficulty,
      issues,
      `${path}.difficulty`
    ),
  };

  if (type === "single_choice") {
    return normalizeSingleChoiceQuestion(q, base, path, issues);
  }
  if (type === "true_false") {
    return normalizeTrueFalseQuestion(q, base, path, issues);
  }
  // Fallback for invalid type: treat as single_choice with empty options
  return {
    type: "single_choice",
    ...base,
    options: [],
    correctOptionId: "A" as OptionId,
  };
}

function normalizeSingleChoiceQuestion(
  q: Record<string, unknown>,
  base: QuestionBase,
  path: string,
  issues: string[]
): Question {
  const rawOptions = Array.isArray(q.options) ? q.options : [];
  if (!Array.isArray(q.options)) {
    issues.push(`${path}.options must be an array`);
  }
  if (rawOptions.length < 2 || rawOptions.length > 4) {
    issues.push(`${path}.options must contain 2 to 4 items`);
  }

  const seen = new Set<string>();
  const options = rawOptions.slice(0, 4).map((opt: unknown, oi: number) => {
    const option =
      opt && typeof opt === "object" ? (opt as Record<string, unknown>) : {};
    const fallbackId: OptionId = OPTION_IDS[oi]!;
    const id =
      typeof option.id === "string" ? option.id.trim() : fallbackId;
    if (!(OPTION_IDS as readonly string[]).includes(id)) {
      issues.push(
        `${path}.options[${oi}].id must be A, B, C, or D`
      );
    }
    if (seen.has(id)) {
      issues.push(`${path}.options contains duplicate id ${id}`);
    }
    seen.add(id);
    return {
      id: id as OptionId,
      text: normalizeText(
        option.text,
        `${path}.options[${oi}].text`,
        LIMITS.optionText,
        issues
      ),
    };
  });

  const correctOptionId =
    typeof q.correctOptionId === "string"
      ? q.correctOptionId.trim()
      : undefined;
  if (!(OPTION_IDS as readonly string[]).includes(correctOptionId ?? "")) {
    issues.push(
      `${path}.correctOptionId must be A, B, C, or D`
    );
  }
  if (
    correctOptionId &&
    !options.some((opt) => opt.id === correctOptionId)
  ) {
    issues.push(
      `${path}.correctOptionId must match an option id`
    );
  }

  return {
    ...base,
    type: "single_choice" as const,
    options,
    correctOptionId: correctOptionId as OptionId,
  };
}

function normalizeTrueFalseQuestion(
  q: Record<string, unknown>,
  base: QuestionBase,
  path: string,
  issues: string[]
): Question {
  if (typeof q.correctAnswer !== "boolean") {
    issues.push(`${path}.correctAnswer must be boolean`);
  }
  return {
    ...base,
    type: "true_false" as const,
    correctAnswer: q.correctAnswer as boolean,
  };
}

function normalizeText(
  value: unknown,
  field: string,
  maxLength: number,
  issues: string[]
): string {
  if (typeof value !== "string") {
    issues.push(`${field} must be a string`);
    return "";
  }
  const text = value.trim();
  if (!text) {
    issues.push(`${field} cannot be empty`);
  }
  if (text.length > maxLength) {
    issues.push(
      `${field} must be at most ${maxLength} characters`
    );
  }
  return text.slice(0, maxLength);
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
  issues: string[]
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return normalizeText(value, field, maxLength, issues);
}

function normalizeDifficulty(
  value: unknown,
  issues: string[],
  field: string = "difficulty"
): QuizGroup["difficulty"] {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (!isDifficulty(value)) {
    issues.push(`${field} must be easy, medium, hard, or insane`);
    return undefined;
  }
  return value;
}

function normalizeTags(
  value: unknown,
  field: string,
  issues: string[]
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return [];
  }
  if (value.length > LIMITS.tagsPerQuestion) {
    issues.push(
      `${field} must contain at most ${LIMITS.tagsPerQuestion} items`
    );
  }
  return value.slice(0, LIMITS.tagsPerQuestion).map((tag: unknown, i: number) => {
    if (typeof tag !== "string") {
      issues.push(`${field}[${i}] must be a string`);
      return "";
    }
    const text = tag.trim();
    if (!text) {
      issues.push(`${field}[${i}] cannot be empty`);
    }
    if (text.length > LIMITS.tag) {
      issues.push(
        `${field}[${i}] must be at most ${LIMITS.tag} characters`
      );
    }
    return text.slice(0, LIMITS.tag);
  });
}
