import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  loadSession,
  saveSession,
  deleteSession,
  createSession,
  type QuizSession,
} from "../state/session-state.js";
import {
  publicQuizGroup,
  normalizeQuizGroup,
} from "../core/validation.js";
import { scoreQuiz, getCorrectAnswer } from "../core/scoring.js";
import { createLocalizedNextGroupPrompt } from "../core/next-group.js";
import type { UserAnswer } from "../core/types.js";

// === Static file serving ===

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const widgetDir = join(__dirname, "widget");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// === Helpers ===

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendError(res: ServerResponse, message: string, status = 400) {
  sendJson(res, { error: message }, status);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function extractSessionId(url: string): string | null {
  // Match /api/session/:id or /api/session/:id/answer or /api/session/:id/next
  const match = url.match(
    /^\/api\/session\/([a-zA-Z0-9_-]+)(?:\/(answer|next))?$/
  );
  if (!match) return null;
  return match[1]!;
}

// === Answer normalization (same as MCP tools.ts) ===

function normalizeAnswer(raw: string, questionType: string): string {
  const trimmed = raw.trim();
  if (questionType === "true_false") {
    const lower = trimmed.toLowerCase();
    if (["true", "t", "yes", "y", "1"].includes(lower)) return "true";
    if (["false", "f", "no", "n", "0"].includes(lower)) return "false";
    return lower;
  }
  const match = trimmed.match(/^[a-dA-D]/);
  return match ? match[0]!.toUpperCase() : trimmed;
}

// === Static file handler ===

async function serveStatic(
  res: ServerResponse,
  urlPath: string
): Promise<boolean> {
  // Map /widget/* to widget directory files
  const relative = urlPath.replace(/^\/widget\//, "");
  if (!relative || relative.includes("..")) return false;

  const filePath = join(widgetDir, relative);
  const ext = "." + (relative.split(".").pop() ?? "html");
  const mime = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// === Route handlers ===

async function handleGetSession(
  res: ServerResponse,
  sessionId: string
) {
  const session = await loadSession(sessionId);
  if (!session) {
    sendError(res, "Session not found or expired", 404);
    return;
  }

  const publicGroup = publicQuizGroup(session.quizGroup);

  sendJson(res, {
    quizGroupId: session.quizGroup.id,
    renderNonce: session.sessionId,
    title: session.quizGroup.title,
    topic: session.quizGroup.topic,
    difficulty: session.quizGroup.difficulty,
    totalQuestions: session.quizGroup.questions.length,
    currentQuestionIndex: session.currentQuestionIndex,
    answeredCount: session.answers.length,
    quizGroup: publicGroup,
  });
}

async function handlePostAnswer(
  res: ServerResponse,
  sessionId: string,
  body: unknown
) {
  const { answer } = (body as Record<string, unknown>) || {};
  if (typeof answer !== "string" || !answer.trim()) {
    sendError(res, "Missing or invalid 'answer' field");
    return;
  }

  const session = await loadSession(sessionId);
  if (!session) {
    sendError(res, "Session not found or expired", 404);
    return;
  }

  const currentQuestion =
    session.quizGroup.questions[session.currentQuestionIndex];
  if (!currentQuestion) {
    sendError(res, "Invalid quiz state — no question at current index");
    return;
  }

  const normalized = normalizeAnswer(answer, currentQuestion.type);
  const userAnswer: UserAnswer = {
    questionId: currentQuestion.id,
    answer: normalized,
  };
  session.answers.push(userAnswer);

  // Score this question
  const correct = getCorrectAnswer(currentQuestion);
  const isCorrect =
    normalized.toLowerCase() ===
    (typeof correct === "boolean" ? String(correct) : correct?.toLowerCase());

  // Format correct answer text for the client
  const correctAnswerText =
    currentQuestion.type === "single_choice"
      ? String(correct)
      : correct === true
        ? "true"
        : "false";

  // Advance to next question
  session.currentQuestionIndex++;
  const isFinished =
    session.currentQuestionIndex >= session.quizGroup.questions.length;

  if (isFinished) {
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

    sendJson(res, {
      correct: isCorrect,
      correctAnswer: correctAnswerText,
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
    });
    return;
  }

  // Save updated session
  await saveSession(session);

  // Get next question (public — no answers)
  const nextQuestion = session.quizGroup.questions[session.currentQuestionIndex]!;
  const nextPublicQuestion =
    publicQuizGroup(session.quizGroup).questions[
      session.currentQuestionIndex
    ]!;

  sendJson(res, {
    correct: isCorrect,
    correctAnswer: correctAnswerText,
    explanation: currentQuestion.explanation,
    finished: false,
    currentQuestion: session.currentQuestionIndex + 1,
    totalQuestions: session.quizGroup.questions.length,
    remainingQuestions:
      session.quizGroup.questions.length - session.currentQuestionIndex,
    questionType: nextQuestion.type,
    nextQuestion: nextPublicQuestion,
  });
}

async function handlePostNext(
  res: ServerResponse,
  sessionId: string,
  body: unknown
) {
  const { locale } = (body as Record<string, unknown>) || {};

  const session = await loadSession(sessionId);
  if (!session) {
    sendError(res, "Session not found or expired", 404);
    return;
  }

  const result = scoreQuiz(session.quizGroup, session.answers);
  const prompt = createLocalizedNextGroupPrompt({
    quizGroup: session.quizGroup,
    result,
    locale: typeof locale === "string" ? locale : undefined,
  });

  sendJson(res, { prompt });
}

// === Main request router ===

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Root: redirect to widget with session query param
  if (pathname === "/" || pathname === "") {
    const session = url.searchParams.get("session");
    if (session) {
      res.writeHead(302, {
        Location: `/widget/index.html?session=${encodeURIComponent(session)}`,
      });
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>QuizCC</title></head>
<body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px">
<h1>QuizCC Web Server</h1>
<p>Use <code>/quiz --web [topic]</code> in Claude Code to start a quiz, then open the URL it gives you.</p>
</body></html>`);
    }
    return;
  }

  // Static files: /widget/*
  if (pathname.startsWith("/widget/")) {
    const served = await serveStatic(res, pathname);
    if (!served) {
      sendError(res, "File not found", 404);
    }
    return;
  }

  // API routes: /api/session/:id[/action]
  if (pathname.startsWith("/api/session/")) {
    const sessionId = extractSessionId(pathname);
    if (!sessionId) {
      sendError(res, "Invalid session ID", 400);
      return;
    }

    const isAnswer = pathname.endsWith("/answer");
    const isNext = pathname.endsWith("/next");

    if (req.method === "GET" && !isAnswer && !isNext) {
      return handleGetSession(res, sessionId);
    }

    if (req.method === "POST") {
      let body: unknown = {};
      try {
        body = await readBody(req);
      } catch {
        sendError(res, "Invalid JSON body", 400);
        return;
      }

      if (isAnswer) {
        return handlePostAnswer(res, sessionId, body);
      }
      if (isNext) {
        return handlePostNext(res, sessionId, body);
      }
    }

    sendError(res, "Not found", 404);
    return;
  }

  // Health check
  if (pathname === "/health") {
    sendJson(res, { ok: true, name: "quizcc-web", version: "1.0.0" });
    return;
  }

  // 404
  sendError(res, "Not found", 404);
}
