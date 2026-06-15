// QuizCC Web Bridge — replaces window.openai + postMessage with REST API calls
// Loads BEFORE app.js so window.openai is pre-populated when app.js initialises.

const SESSION_ID = new URLSearchParams(window.location.search).get("session");

// === State variables (exposed for app.js to read) ===
export let lastSubmitResult = null;    // latest answer submission result
export let lastSummary = null;         // final summary (when finished === true)

export function getSessionId() {
  return SESSION_ID;
}

// === API helpers ===

async function apiGet(path) {
  if (!SESSION_ID) throw new Error("No session ID in URL");
  const resp = await fetch(path);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${resp.status}`);
  }
  return resp.json();
}

async function apiPost(path, body = {}) {
  if (!SESSION_ID) throw new Error("No session ID in URL");
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `API error: ${resp.status}`);
  }
  return resp.json();
}

// === API functions (called by app.js) ===

/**
 * Submit an answer for the current question.
 * Returns { correct, correctAnswer, explanation, finished, currentQuestion, totalQuestions, questionType }
 * If finished, also returns { score, weakTags, mistakes }.
 */
export async function submitAnswerAPI(questionId, answer) {
  const result = await apiPost(`/api/session/${SESSION_ID}/answer`, { answer });
  lastSubmitResult = result;
  if (result.finished) {
    lastSummary = result;
  }
  return result;
}

/**
 * Fetch the next-group prompt from the server.
 * Returns { prompt }.
 */
export async function requestNextGroupAPI(locale) {
  const result = await apiPost(`/api/session/${SESSION_ID}/next`, { locale });
  return result;
}

// === Initialisation ===

/**
 * Load quiz data from the server and populate window.openai so that
 * the existing app.js extractQuizGroupFromOpenAI() works unchanged.
 *
 * The server returns a public quiz group (no correct answers) via publicQuizGroup().
 * Scoring is done server-side — the widget never knows the correct answers.
 */
async function initOpenAIBridge() {
  if (!SESSION_ID) {
    document.getElementById("quizcat-root")?.insertAdjacentHTML(
      "afterbegin",
      `<main class="quizcat"><div class="quizcat__empty">Missing session ID. Add ?session=&lt;id&gt; to the URL.</div></main>`
    );
    return;
  }

  try {
    const data = await apiGet(`/api/session/${SESSION_ID}`);

    // Build a window.openai-shaped object for app.js compatibility.
    // toolOutput.structuredContent should contain the public quiz group fields
    // that extractQuizGroupFromOpenAI() expects.
    window.openai = {
      locale: navigator.language,
      toolOutput: {
        structuredContent: {
          quizGroupId: data.quizGroupId,
          renderNonce: data.renderNonce || SESSION_ID,
          title: data.title,
          topic: data.topic,
          difficulty: data.difficulty,
          questionCount: data.totalQuestions,
          quizGroup: data.quizGroup, // public quiz (no correct answers)
        },
      },
      // toolResponseMetadata is where extractQuizGroupFromOpenAI looks for _meta.quizGroup.
      // We set it to null — the widget must NOT have access to correct answers.
      toolResponseMetadata: {
        _meta: { quizGroup: null },
      },
      // Widget state persistence goes to localStorage (not iframe host)
      setWidgetState: (state) => {
        try {
          localStorage.setItem("quizcc-state", JSON.stringify(state));
        } catch {}
      },
      // Not needed in standalone page
      notifyIntrinsicHeight: () => {},
      // sendFollowUpMessage is replaced by our requestNextGroupAPI
      sendFollowUpMessage: null,
      // Use viewport height
      maxHeight: window.innerHeight,
    };

    // Restore widget state if reloading
    restoreWidgetState();
  } catch (err) {
    console.error("QuizCC bridge init failed:", err);
    document.getElementById("quizcat-root")?.insertAdjacentHTML(
      "afterbegin",
      `<main class="quizcat"><div class="quizcat__empty">Quiz session not found or expired.<br>Generate a new quiz in Claude Code with /quiz --web [topic].</div></main>`
    );
  }
}

function restoreWidgetState() {
  try {
    const raw = localStorage.getItem("quizcc-state");
    if (!raw) return;
    const state = JSON.parse(raw);
    // Store on window.openai so app.js can read it back
    window.openai._restoredState = state;
  } catch {}
}

// === Boot ===
await initOpenAIBridge();
