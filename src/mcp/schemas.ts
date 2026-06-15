import { z } from "zod";

// === Schema fragments ===

const optionSchema = z.object({
  id: z.enum(["A", "B", "C", "D"]),
  text: z.string().min(1).max(300),
});

const singleChoiceQuestionSchema = z.object({
  type: z.literal("single_choice"),
  id: z.string().max(120).optional(),
  stem: z.string().min(1).max(1000),
  options: z.array(optionSchema).min(2).max(4),
  correctOptionId: z.enum(["A", "B", "C", "D"]),
  explanation: z.string().max(1500).optional(),
  tags: z.array(z.string().max(40)).max(8).optional(),
  difficulty: z.enum(["easy", "medium", "hard", "insane"]).optional(),
});

const trueFalseQuestionSchema = z.object({
  type: z.literal("true_false"),
  id: z.string().max(120).optional(),
  stem: z.string().min(1).max(1000),
  correctAnswer: z.boolean(),
  explanation: z.string().max(1500).optional(),
  tags: z.array(z.string().max(40)).max(8).optional(),
  difficulty: z.enum(["easy", "medium", "hard", "insane"]).optional(),
});

const questionSchema = z.discriminatedUnion("type", [
  singleChoiceQuestionSchema,
  trueFalseQuestionSchema,
]);

export const quizGroupInputSchema = z.object({
  title: z.string().min(1).max(120),
  topic: z.string().max(120).optional(),
  difficulty: z.enum(["easy", "medium", "hard", "insane"]).optional(),
  questions: z.array(questionSchema).min(1).max(10),
});

// === Tool input schemas ===

export const startQuizInputSchema = z.object({
  quizGroup: quizGroupInputSchema,
});

export const submitAnswerInputSchema = z.object({
  sessionId: z.string().min(1),
  answer: z.string().min(1),
});

export const getQuizStateInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const getNextGroupPromptInputSchema = z.object({
  sessionId: z.string().min(1),
  locale: z.string().optional(),
});

// === Tool output schemas ===

export const startQuizOutputSchema = z.object({
  sessionId: z.string(),
  quizGroupId: z.string(),
  title: z.string(),
  topic: z.string().optional(),
  difficulty: z.string().optional(),
  questionType: z.string(),
  currentQuestion: z.number(),
  totalQuestions: z.number(),
});

export const submitAnswerOutputSchema = z.object({
  correct: z.boolean(),
  correctAnswer: z.string().optional(),
  explanation: z.string().optional(),
  finished: z.boolean(),
  currentQuestion: z.number().optional(),
  totalQuestions: z.number().optional(),
  remainingQuestions: z.number().optional(),
  questionType: z.string().optional(),
  score: z
    .object({
      totalQuestions: z.number(),
      correctCount: z.number(),
      wrongCount: z.number(),
      accuracy: z.number(),
    })
    .optional(),
  weakTags: z.array(z.string()).optional(),
  mistakes: z
    .array(
      z.object({
        questionId: z.string(),
        userAnswer: z.string(),
        correctAnswer: z.string(),
        stem: z.string(),
        explanation: z.string().optional(),
      })
    )
    .optional(),
});

// Re-export z for convenience
export { z };
