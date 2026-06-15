import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  handleStartQuiz,
  handleSubmitAnswer,
  handleGetQuizState,
  handleGetNextGroupPrompt,
} from "../src/mcp/tools.js";

// Use a temporary state directory for tests
const TEST_STATE_DIR = join(tmpdir(), `quizcc-test-${randomUUID()}`);

beforeEach(async () => {
  process.env.QUIZCC_STATE_DIR = TEST_STATE_DIR;
  await mkdir(TEST_STATE_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_STATE_DIR, { recursive: true, force: true });
});

const SAMPLE_QUIZ_GROUP = {
  title: "Test Quiz",
  topic: "Testing",
  difficulty: "medium" as const,
  questions: [
    {
      type: "single_choice" as const,
      id: "q1",
      stem: "What is the capital of France?",
      options: [
        { id: "A" as const, text: "Paris" },
        { id: "B" as const, text: "London" },
        { id: "C" as const, text: "Berlin" },
        { id: "D" as const, text: "Madrid" },
      ],
      correctOptionId: "A" as const,
      explanation: "Paris is the capital of France.",
      tags: ["geography", "europe"],
    },
    {
      type: "true_false" as const,
      id: "q2",
      stem: "The Earth is flat.",
      correctAnswer: false,
      explanation: "The Earth is an oblate spheroid.",
      tags: ["science"],
    },
    {
      type: "single_choice" as const,
      id: "q3",
      stem: "Which language runs in the browser?",
      options: [
        { id: "A" as const, text: "Python" },
        { id: "B" as const, text: "JavaScript" },
        { id: "C" as const, text: "Java" },
      ],
      correctOptionId: "B" as const,
      tags: ["programming"],
    },
  ],
};

describe("start_quiz", () => {
  it("returns the first question as Markdown with session metadata", async () => {
    const result = await handleStartQuiz({
      quizGroup: SAMPLE_QUIZ_GROUP,
    });

    expect(result.content).toHaveLength(1);
    const text = result.content[0]!.text as string;
    expect(text).toContain("# Test Quiz");
    expect(text).toContain("**Difficulty:** medium");
    expect(text).toContain("**Question 1/3**");
    expect(text).toContain("What is the capital of France?");
    expect(text).toContain("A) Paris");
    expect(text).toContain("Type **A**, **B**, **C**, or **D**");

    expect(result.structuredContent).toBeDefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.sessionId).toMatch(/^qcsess-/);
    expect(sc.totalQuestions).toBe(3);
    expect(sc.currentQuestion).toBe(1);

    // _meta should contain private data
    expect(result._meta).toBeDefined();
    const meta = result._meta as Record<string, unknown>;
    expect(meta.sessionId).toBe(sc.sessionId);
    expect(meta.quizGroup).toBeDefined();

    return sc.sessionId as string; // pass to subsequent tests
  });

  it("returns true/false question format correctly", async () => {
    const result = await handleStartQuiz({
      quizGroup: {
        title: "TF Quiz",
        questions: [
          {
            type: "true_false",
            stem: "The sky is blue.",
            correctAnswer: true,
            tags: ["general"],
          },
        ],
      },
    });

    const text = result.content[0]!.text as string;
    expect(text).toContain("Type **True** or **False**");
  });

  it("rejects invalid quiz data", async () => {
    await expect(
      handleStartQuiz({
        quizGroup: { title: "", questions: [] },
      })
    ).rejects.toThrow();
  });
});

describe("submit_answer", () => {
  let sessionId: string;

  beforeEach(async () => {
    const result = await handleStartQuiz({
      quizGroup: SAMPLE_QUIZ_GROUP,
    });
    sessionId = (result._meta as Record<string, unknown>).sessionId as string;
  });

  it("returns correct feedback for a right answer", async () => {
    const result = await handleSubmitAnswer({
      sessionId,
      answer: "A",
    });

    const text = result.content[0]!.text as string;
    expect(text).toContain("✅");
    expect(text).toContain("Correct");

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.correct).toBe(true);
    expect(sc.finished).toBe(false);
  });

  it("returns wrong feedback for an incorrect answer", async () => {
    const result = await handleSubmitAnswer({
      sessionId,
      answer: "B",
    });

    const text = result.content[0]!.text as string;
    expect(text).toContain("❌");
    expect(text).toContain("Not quite");

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.correct).toBe(false);
  });

  it("advances to the next question after answering", async () => {
    await handleSubmitAnswer({ sessionId, answer: "A" });

    const sc = (await handleSubmitAnswer({ sessionId, answer: "true" }))
      .structuredContent as Record<string, unknown>;
    // After answering q1 and q2, we should be on q3 and still not finished
    expect(sc.finished).toBe(false);
  });

  it("returns final summary after last question", async () => {
    await handleSubmitAnswer({ sessionId, answer: "A" }); // q1 correct
    await handleSubmitAnswer({ sessionId, answer: "true" }); // q2 wrong (correct is false)

    const result = await handleSubmitAnswer({ sessionId, answer: "B" }); // q3 correct

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.finished).toBe(true);
    expect(sc.score).toBeDefined();
    const score = sc.score as Record<string, unknown>;
    expect(score.totalQuestions).toBe(3);
    expect(score.correctCount).toBe(2);

    // Should have summary content
    const texts = result.content.map((c) => c.text).join("\n");
    expect(texts).toContain("Quiz Complete");
    expect(texts).toContain("2/3");
  });

  it("normalizes answer formats", async () => {
    // "a" lowercase should match "A"
    const result = await handleSubmitAnswer({
      sessionId,
      answer: "a",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.correct).toBe(true);
  });

  it("returns error for invalid session ID", async () => {
    const result = await handleSubmitAnswer({
      sessionId: "nonexistent-session",
      answer: "A",
    });
    expect(result.isError).toBe(true);
    const text = result.content[0]!.text as string;
    expect(text).toContain("Session not found");
  });
});

describe("get_quiz_state", () => {
  it("returns state for active session", async () => {
    const start = await handleStartQuiz({
      quizGroup: SAMPLE_QUIZ_GROUP,
    });
    const sid = (start._meta as Record<string, unknown>).sessionId as string;

    const result = await handleGetQuizState({ sessionId: sid });
    const text = result.content[0]!.text as string;
    expect(text).toContain("Test Quiz");
    expect(text).toContain("0/3");
    expect(text).toContain(sid);
  });

  it("returns error for invalid session", async () => {
    const result = await handleGetQuizState({
      sessionId: "nonexistent",
    });
    expect(result.isError).toBe(true);
  });
});

describe("get_next_group_prompt", () => {
  it("generates a prompt with weak areas", async () => {
    const start = await handleStartQuiz({
      quizGroup: SAMPLE_QUIZ_GROUP,
    });
    const sid = (start._meta as Record<string, unknown>).sessionId as string;

    // Answer two questions wrong
    await handleSubmitAnswer({ sessionId: sid, answer: "B" }); // wrong
    await handleSubmitAnswer({ sessionId: sid, answer: "true" }); // wrong

    const result = await handleGetNextGroupPrompt({
      sessionId: sid,
      locale: "en",
    });
    const text = result.content[0]!.text as string;
    expect(text).toContain("QuizCC");
    expect(text).toContain("start_quiz");
    // The weak tags should be geography, europe, science
    expect(text).toContain("geography");
  });

  it("returns error for invalid session", async () => {
    const result = await handleGetNextGroupPrompt({
      sessionId: "nonexistent",
    });
    expect(result.isError).toBe(true);
  });
});
