import { describe, it, expect } from "vitest";
import {
  normalizeQuizGroup,
  QuizValidationError,
  scoreQuiz,
  createNextGroupPrompt,
  createLocalizedNextGroupPrompt,
} from "../src/core/index.js";

describe("normalizeQuizGroup", () => {
  it("validates and normalizes a well-formed quiz group", () => {
    const quizGroup = normalizeQuizGroup({
      title: "Transformer Basics",
      topic: "LLM",
      difficulty: "hard",
      questions: [
        {
          type: "single_choice",
          id: "q1",
          stem: "What prevents attention to future tokens?",
          options: [
            { id: "A", text: "Causal masking" },
            { id: "B", text: "Dropout" },
          ],
          correctOptionId: "A",
          explanation: "Masks future positions.",
          tags: ["attention", "causal masking"],
        },
        {
          type: "true_false",
          id: "q2",
          stem: "Self-attention derives Q, K, V from the same sequence.",
          correctAnswer: true,
          tags: ["attention"],
        },
      ],
    });

    expect(quizGroup.title).toBe("Transformer Basics");
    expect(quizGroup.topic).toBe("LLM");
    expect(quizGroup.difficulty).toBe("hard");
    expect(quizGroup.questions).toHaveLength(2);
    expect(quizGroup.id).toMatch(/^quizcc-/);
  });

  it("generates an ID if none is provided", () => {
    const quizGroup = normalizeQuizGroup({
      title: "Test",
      questions: [
        {
          type: "true_false",
          stem: "A test question.",
          correctAnswer: true,
        },
      ],
    });
    expect(quizGroup.id).toMatch(/^quizcc-/);
  });

  it("rejects invalid quiz groups with useful issues", () => {
    expect(() =>
      normalizeQuizGroup({
        title: "Broken",
        questions: [
          {
            type: "single_choice",
            stem: "",
            options: [{ id: "A", text: "Only one" }],
            correctOptionId: "D",
          },
        ],
      })
    ).toThrow(QuizValidationError);

    try {
      normalizeQuizGroup({
        title: "Broken",
        questions: [
          {
            type: "single_choice",
            stem: "",
            options: [{ id: "A", text: "Only one" }],
            correctOptionId: "D",
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(QuizValidationError);
      const e = error as QuizValidationError;
      expect(e.issues.some((i) => i.includes("stem"))).toBe(true);
      expect(e.issues.some((i) => i.includes("options"))).toBe(true);
      expect(
        e.issues.some((i) => i.includes("correctOptionId"))
      ).toBe(true);
    }
  });

  it("rejects empty questions array", () => {
    expect(() =>
      normalizeQuizGroup({ title: "Empty", questions: [] })
    ).toThrow(QuizValidationError);
  });

  it("rejects more than 10 questions", () => {
    const questions = Array.from({ length: 11 }, (_, i) => ({
      type: "true_false" as const,
      stem: `Q${i + 1}`,
      correctAnswer: true,
    }));
    expect(() =>
      normalizeQuizGroup({ title: "Too many", questions })
    ).toThrow(QuizValidationError);
  });

  it("rejects non-array questions", () => {
    expect(() =>
      normalizeQuizGroup({
        title: "Non-array",
        questions: "not-an-array",
      })
    ).toThrow(QuizValidationError);
  });
});

describe("scoreQuiz", () => {
  it("scores single choice and true/false questions", () => {
    const quizGroup = normalizeQuizGroup({
      title: "Transformer Basics",
      topic: "LLM",
      difficulty: "hard",
      questions: [
        {
          type: "single_choice",
          id: "q1",
          stem: "What prevents attention to future tokens?",
          options: [
            { id: "A", text: "Causal masking" },
            { id: "B", text: "Dropout" },
          ],
          correctOptionId: "A",
          explanation: "Masks future positions.",
          tags: ["attention", "causal masking"],
        },
        {
          type: "true_false",
          id: "q2",
          stem: "Self-attention derives Q, K, V from the same sequence.",
          correctAnswer: true,
          tags: ["attention"],
        },
      ],
    });

    const result = scoreQuiz(quizGroup, [
      { questionId: "q1", answer: "B" },
      { questionId: "q2", answer: true },
    ]);

    expect(result.totalQuestions).toBe(2);
    expect(result.correctCount).toBe(1);
    expect(result.wrongCount).toBe(1);
    expect(result.accuracy).toBe(50);
    expect(result.weakTags).toEqual(["attention", "causal masking"]);
  });

  it("calculates perfect score", () => {
    const quizGroup = normalizeQuizGroup({
      title: "Easy Quiz",
      questions: [
        {
          type: "true_false",
          id: "q1",
          stem: "The sky is blue.",
          correctAnswer: true,
          tags: ["general"],
        },
      ],
    });

    const result = scoreQuiz(quizGroup, [
      { questionId: "q1", answer: true },
    ]);

    expect(result.correctCount).toBe(1);
    expect(result.accuracy).toBe(100);
    expect(result.weakTags).toEqual([]);
  });

  it("handles missing answers gracefully", () => {
    const quizGroup = normalizeQuizGroup({
      title: "Partial",
      questions: [
        {
          type: "true_false",
          id: "q1",
          stem: "Question 1",
          correctAnswer: true,
        },
      ],
    });

    const result = scoreQuiz(quizGroup, []);

    expect(result.correctCount).toBe(0);
    expect(result.wrongCount).toBe(1);
    expect(result.answers[0]!.isCorrect).toBe(false);
  });
});

describe("next group prompts", () => {
  it("creates Chinese next group prompt from result", () => {
    const quizGroup = normalizeQuizGroup({
      id: "quizcc-demo-2",
      title: "LLM Quiz",
      topic: "LLM",
      difficulty: "hard",
      questions: [
        {
          type: "true_false",
          id: "q1",
          stem: "Causal masking hides future tokens.",
          correctAnswer: true,
          tags: ["causal masking"],
        },
      ],
    });
    const result = scoreQuiz(quizGroup, [
      { questionId: "q1", answer: false },
    ]);
    const prompt = createNextGroupPrompt({ quizGroup, result });

    expect(prompt).toContain("quizcc-demo-2");
    expect(prompt).toContain("LLM");
    expect(prompt).toContain("hard");
    expect(prompt).toContain("causal masking");
    expect(prompt).toContain("start_quiz");
  });

  it("creates localized next group prompt for different locales", () => {
    const quizGroup = normalizeQuizGroup({
      id: "quizcc-local",
      title: "Test Quiz",
      topic: "Testing",
      questions: [
        {
          type: "true_false",
          id: "q1",
          stem: "Testing is important.",
          correctAnswer: true,
          tags: ["testing"],
        },
      ],
    });
    const result = scoreQuiz(quizGroup, [
      { questionId: "q1", answer: true },
    ]);

    const promptEn = createLocalizedNextGroupPrompt({
      quizGroup,
      result,
      locale: "en",
    });
    expect(promptEn).toContain("QuizCC");
    expect(promptEn).toContain("start_quiz");

    const promptZh = createLocalizedNextGroupPrompt({
      quizGroup,
      result,
      locale: "zh-CN",
    });
    expect(promptZh).toContain("QuizCC");
    expect(promptZh).toContain("start_quiz");

    const promptJa = createLocalizedNextGroupPrompt({
      quizGroup,
      result,
      locale: "ja",
    });
    expect(promptJa).toContain("QuizCC");
    expect(promptJa).toContain("start_quiz");
  });
});
