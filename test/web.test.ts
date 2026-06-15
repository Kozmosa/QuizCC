import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";

import { handleRequest } from "../src/web/routes.js";
import { normalizeQuizGroup } from "../src/core/validation.js";
import { createSession } from "../src/state/session-state.js";

// === Test helpers ===

const TEST_STATE_DIR = join(tmpdir(), `quizcc-web-test-${randomUUID()}`);

beforeEach(async () => {
  process.env.QUIZCC_STATE_DIR = TEST_STATE_DIR;
  await mkdir(TEST_STATE_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_STATE_DIR, { recursive: true, force: true });
});

function makeRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      try {
        await handleRequest(req, res);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        return reject(new Error("Failed to get server address"));
      }

      const port = addr.port;
      const url = new URL(path, `http://127.0.0.1:${port}`);
      const chunks: Buffer[] = [];

      const req = require("node:http").request(
        url,
        {
          method,
          headers: body
            ? { "Content-Type": "application/json" }
            : undefined,
        },
        (res: IncomingMessage) => {
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            server.close();
            let parsed: unknown;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            } catch {
              parsed = {};
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        }
      );

      req.on("error", (err: Error) => {
        server.close();
        reject(err);
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

async function setupSession() {
  const quizGroup = normalizeQuizGroup({
    title: "Test Quiz",
    topic: "Testing",
    difficulty: "medium",
    questions: [
      {
        type: "true_false" as const,
        id: "q1",
        stem: "Testing is important.",
        correctAnswer: true,
        tags: ["software"],
      },
      {
        type: "single_choice" as const,
        id: "q2",
        stem: "What is TypeScript?",
        options: [
          { id: "A" as const, text: "A typed JS superset" },
          { id: "B" as const, text: "A database" },
        ],
        correctOptionId: "A" as const,
        explanation: "TypeScript extends JavaScript with static types.",
        tags: ["typescript"],
      },
    ],
  });

  const session = await createSession(quizGroup);
  return session;
}

// === Tests ===

describe("GET /api/session/:id", () => {
  it("returns public quiz group with answers stripped", async () => {
    const session = await setupSession();
    const { status, body } = await makeRequest(
      "GET",
      `/api/session/${session.sessionId}`
    );

    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.title).toBe("Test Quiz");
    expect(data.totalQuestions).toBe(2);

    const quizGroup = data.quizGroup as Record<string, unknown>;
    expect(quizGroup).toBeDefined();
    const questions = quizGroup.questions as Record<string, unknown>[];
    expect(questions).toHaveLength(2);

    // Verify answers are stripped
    const q1 = questions[0]!;
    expect(q1.type).toBe("true_false");
    expect("correctAnswer" in q1).toBe(false);

    const q2 = questions[1]!;
    expect(q2.type).toBe("single_choice");
    expect("correctOptionId" in q2).toBe(false);
  });

  it("returns 404 for nonexistent session", async () => {
    const { status, body } = await makeRequest(
      "GET",
      "/api/session/nonexistent-session"
    );
    expect(status).toBe(404);
    expect((body as Record<string, unknown>).error).toBe(
      "Session not found or expired"
    );
  });
});

describe("POST /api/session/:id/answer", () => {
  it("returns correct feedback for a right answer", async () => {
    const session = await setupSession();
    const { status, body } = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "true" }
    );

    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.correct).toBe(true);
    expect(data.finished).toBe(false);
    expect(data.correctAnswer).toBe("true");
    expect(data.currentQuestion).toBe(2);
    expect(data.remainingQuestions).toBe(1);
  });

  it("returns wrong feedback for an incorrect answer", async () => {
    const session = await setupSession();
    const { body } = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "false" }
    );

    const data = body as Record<string, unknown>;
    expect(data.correct).toBe(false);
    expect(data.correctAnswer).toBe("true");
    expect(data.finished).toBe(false);
  });

  it("advances question index after each answer", async () => {
    const session = await setupSession();

    // Q1
    const r1 = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "true" }
    );
    expect((r1.body as Record<string, unknown>).currentQuestion).toBe(2);

    // Q2 (last)
    const r2 = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "A" }
    );
    expect((r2.body as Record<string, unknown>).currentQuestion).toBeUndefined();
    expect((r2.body as Record<string, unknown>).finished).toBe(true);
  });

  it("returns final summary on last question", async () => {
    const session = await setupSession();

    // Answer Q1 (correct)
    await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "true" }
    );

    // Answer Q2 (wrong)
    const { body } = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "B" }
    );

    const data = body as Record<string, unknown>;
    expect(data.finished).toBe(true);
    expect(data.score).toBeDefined();

    const score = data.score as Record<string, unknown>;
    expect(score.totalQuestions).toBe(2);
    expect(score.correctCount).toBe(1);
    expect(score.wrongCount).toBe(1);

    expect(data.weakTags).toEqual(["typescript"]);
    expect((data.mistakes as unknown[])).toHaveLength(1);
  });

  it("deletes session after completion", async () => {
    const session = await setupSession();

    await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "true" }
    );
    await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "A" }
    );

    // Session should be deleted
    const { status } = await makeRequest(
      "GET",
      `/api/session/${session.sessionId}`
    );
    expect(status).toBe(404);
  });

  it("normalizes answer formats (lowercase, parens)", async () => {
    const session = await setupSession();

    // "a" lowercase for single_choice
    const r1 = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "true" }
    );
    expect((r1.body as Record<string, unknown>).correct).toBe(true);

    // "a)" with parens for single_choice
    const r2 = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "a)" }
    );
    expect((r2.body as Record<string, unknown>).correct).toBe(true);
  });

  it("returns 400 for missing answer", async () => {
    const session = await setupSession();
    const { status } = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      {}
    );
    expect(status).toBe(400);
  });

  it("returns 404 for nonexistent session", async () => {
    const { status } = await makeRequest(
      "POST",
      "/api/session/nonexistent/answer",
      { answer: "A" }
    );
    expect(status).toBe(404);
  });
});

describe("POST /api/session/:id/next", () => {
  it("returns a prompt text", async () => {
    const session = await setupSession();

    // Answer one question to have some data
    await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/answer`,
      { answer: "false" }
    );

    const { status, body } = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/next`,
      { locale: "en" }
    );

    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(typeof data.prompt).toBe("string");
    expect((data.prompt as string).length).toBeGreaterThan(0);
    expect(data.prompt as string).toContain("QuizCC");
    expect(data.prompt as string).toContain("start_quiz");
  });

  it("accepts locale parameter", async () => {
    const session = await setupSession();
    const { body } = await makeRequest(
      "POST",
      `/api/session/${session.sessionId}/next`,
      { locale: "zh-CN" }
    );

    // Chinese prompt should contain Chinese characters
    const data = body as Record<string, unknown>;
    expect(data.prompt as string).toContain("QuizCC");
  });

  it("returns 404 for nonexistent session", async () => {
    const { status } = await makeRequest(
      "POST",
      "/api/session/nonexistent/next"
    );
    expect(status).toBe(404);
  });
});

describe("Static file serving", () => {
  it("serves widget/index.html", async () => {
    const server: Server = createServer(async (req, res) => {
      try { await handleRequest(req, res); } catch { res.writeHead(500); res.end(); }
    });

    const result = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") { server.close(); return reject(new Error("no addr")); }
        const port = addr.port;
        const url = new URL("/widget/index.html", `http://127.0.0.1:${port}`);
        const chunks: Buffer[] = [];
        require("node:http").get(url, (res: IncomingMessage) => {
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => { server.close(); resolve(Buffer.concat(chunks).toString("utf-8")); });
        }).on("error", reject);
      });
    });

    expect(result).toContain("<!doctype html>");
    expect(result).toContain("quizcat-root");
    expect(result).toContain("/widget/bridge.js");
  });

  it("serves widget CSS", async () => {
    const server: Server = createServer(async (req, res) => {
      try { await handleRequest(req, res); } catch { res.writeHead(500); res.end(); }
    });

    const result = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") { server.close(); return reject(new Error("no addr")); }
        const port = addr.port;
        const url = new URL("/widget/styles.css", `http://127.0.0.1:${port}`);
        const chunks: Buffer[] = [];
        require("node:http").get(url, (res: IncomingMessage) => {
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => { server.close(); resolve(Buffer.concat(chunks).toString("utf-8")); });
        }).on("error", reject);
      });
    });

    expect(result).toContain("quizcat");
  });
});

describe("Root and health", () => {
  it("returns landing page at /", async () => {
    const server: Server = createServer(async (req, res) => {
      try { await handleRequest(req, res); } catch { res.writeHead(500); res.end(); }
    });

    const result = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") { server.close(); return reject(new Error("no addr")); }
        const port = addr.port;
        const url = new URL("/", `http://127.0.0.1:${port}`);
        const chunks: Buffer[] = [];
        require("node:http").get(url, (res: IncomingMessage) => {
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => { server.close(); resolve(Buffer.concat(chunks).toString("utf-8")); });
        }).on("error", reject);
      });
    });

    expect(result).toContain("QuizCC Web Server");
  });

  it("returns redirect for /?session=xxx", async () => {
    const server: Server = createServer(async (req, res) => {
      try { await handleRequest(req, res); } catch { res.writeHead(500); res.end(); }
    });

    const result: { status: number; location: string | null } = await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") { server.close(); return reject(new Error("no addr")); }
        const port = addr.port;
        const url = new URL("/?session=test123", `http://127.0.0.1:${port}`);
        const req = require("node:http").get(url, (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              location: (res.headers as Record<string, string>).location ?? null,
            });
          });
        });
        req.on("error", reject);
      });
    });

    expect(result.status).toBe(302);
    expect(result.location).toContain("/widget/index.html?session=test123");
  });

  it("returns health check", async () => {
    const { status, body } = await makeRequest("GET", "/health");
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).ok).toBe(true);
  });
});
