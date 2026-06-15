import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createQuizGroupId } from "../core/validation.js";
import type { QuizGroup, UserAnswer } from "../core/types.js";

// === Session types ===

export interface QuizSession {
  sessionId: string;
  quizGroup: QuizGroup;
  currentQuestionIndex: number;
  answers: UserAnswer[];
  createdAt: string;
}

// === State directory ===

const STATE_DIR =
  process.env.QUIZCC_STATE_DIR ||
  join(process.cwd(), ".claude", "quizcc");

let stateDirEnsured = false;

async function ensureStateDir(): Promise<void> {
  if (stateDirEnsured) return;
  await mkdir(STATE_DIR, { recursive: true });
  stateDirEnsured = true;
}

function getSessionPath(sessionId: string): string {
  return join(STATE_DIR, `${sessionId}.json`);
}

// === CRUD operations ===

export async function createSession(quizGroup: QuizGroup): Promise<QuizSession> {
  await ensureStateDir();
  const session: QuizSession = {
    sessionId: createQuizGroupId("qcsess"),
    quizGroup,
    currentQuestionIndex: 0,
    answers: [],
    createdAt: new Date().toISOString(),
  };
  await writeFile(
    getSessionPath(session.sessionId),
    JSON.stringify(session, null, 2),
    "utf-8"
  );
  return session;
}

export async function loadSession(
  sessionId: string
): Promise<QuizSession | null> {
  await ensureStateDir();
  try {
    const raw = await readFile(getSessionPath(sessionId), "utf-8");
    return JSON.parse(raw) as QuizSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: QuizSession): Promise<void> {
  await ensureStateDir();
  await writeFile(
    getSessionPath(session.sessionId),
    JSON.stringify(session, null, 2),
    "utf-8"
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await unlink(getSessionPath(sessionId));
  } catch {
    // File may already be gone; that's fine.
  }
}
