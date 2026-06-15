import {
  detectLocale,
  getMessages
} from "./i18n.js";

import {
  getSessionId,
  submitAnswerAPI,
  requestNextGroupAPI,
  lastSubmitResult,
  lastSummary,
} from "./bridge.js";

const root = document.getElementById("quizcat-root") || document.body;

const DEFAULT_WIDGET_HEIGHT = 680;
const MIN_WIDGET_HEIGHT = 620;

let quizGroup = null;
let quizGroupId = undefined;
let currentIndex = 0;
let selectedAnswers = {};
let submittedAnswers = {};   // Maps questionId -> { userAnswer, correct, correctAnswer, explanation }
let summaryVisible = false;
let locale = detectLocale();
let enterAnimation = false;
let navigationLocked = false;
let nextGroupPending = false;

syncHostMetrics();
loadFromBridge();
restoreWidgetState();
render();

// === Init (replaces loadFromWindowOpenAI + installHostListeners) ===

function loadFromBridge() {
  // window.openai is pre-populated by bridge.js before this module loads
  const incoming = extractQuizGroupFromBridge();
  if (incoming) {
    loadQuizGroup(incoming);
  } else if (!quizGroup && (!window.openai?.toolOutput?.structuredContent?.quizGroup)) {
    // bridge failed — the empty state is already rendered
  }
}

function restoreWidgetState() {
  const state = window.openai?._restoredState;
  if (!state) return;

  // Only restore if the quiz group ID matches (same session)
  if (state.quizGroupId && quizGroupId && state.quizGroupId !== quizGroupId) return;

  if (typeof state.currentIndex === "number") currentIndex = state.currentIndex;
  if (state.selectedAnswers) selectedAnswers = state.selectedAnswers;
  if (state.submittedAnswers) submittedAnswers = state.submittedAnswers;
  if (typeof state.summaryVisible === "boolean") summaryVisible = state.summaryVisible;

  // Clear restored state so we don't re-apply on hot-reload
  delete window.openai._restoredState;
}

function extractQuizGroupFromBridge() {
  const openai = window.openai;
  if (!openai) return undefined;

  const toolOutput = openai.toolOutput || openai.toolResult;
  const structuredContent =
    toolOutput?.structuredContent ||
    toolOutput?.result?.structuredContent ||
    toolOutput;

  // The bridge puts quiz data in structuredContent.quizGroup (public, no answers)
  const group = structuredContent?.quizGroup || structuredContent;

  if (!group?.questions?.length) return undefined;

  return {
    ...group,
    id: structuredContent?.quizGroupId || group.id,
    __renderNonce: structuredContent?.renderNonce,
  };
}

// === State management ===

function loadQuizGroup(nextQuizGroup) {
  quizGroup = nextQuizGroup;
  quizGroupId = nextQuizGroup.id || quizGroupId;
  locale = detectLocale();
  currentIndex = 0;
  selectedAnswers = {};
  submittedAnswers = {};
  summaryVisible = false;
  navigationLocked = false;
  nextGroupPending = false;
  persistWidgetState();
}

function persistWidgetState() {
  try {
    localStorage.setItem("quizcc-state", JSON.stringify({
      quizGroupId,
      currentIndex,
      selectedAnswers,
      submittedAnswers,
      summaryVisible,
    }));
  } catch {}
}

// === Render (unchanged from QuizCat except where noted) ===

function render() {
  const messages = getMessages(locale);

  if (!quizGroup?.questions?.length) {
    root.innerHTML = `
      <main class="quizcat">
        <div class="quizcat__empty">${escapeHtml(messages.waiting)}</div>
      </main>
    `;
    return;
  }

  const finished = summaryVisible;

  root.innerHTML = `
    <main class="quizcat" aria-live="polite">
      ${renderHeader(finished, messages)}
      <section class="quizcat__body">
        <div class="quizcat__card ${enterAnimation ? "quizcat__card--fade-in" : ""}" data-swipe-card>
          ${finished ? renderSummary(messages) : renderQuestion(messages)}
        </div>
      </section>
    </main>
  `;

  bindEvents();
}

function renderHeader(finished, messages) {
  const total = quizGroup.questions.length;
  const done = finished ? total : currentIndex + 1;

  return `
    <header class="quizcat__progress-row" aria-label="${escapeAttribute(messages.summary)}">
      <div class="quizcat__progress-dots" aria-hidden="true">
        ${quizGroup.questions
          .map((_, index) => {
            const status =
              finished || index < currentIndex
                ? "done"
                : index === currentIndex
                  ? "active"
                  : "idle";

            return `
              <button
                class="quizcat__progress-dot quizcat__progress-dot--${status}"
                data-action="go-question"
                data-index="${index}"
                aria-label="${index + 1}/${total}"
              ></button>
            `;
          })
          .join("")}
      </div>
      <div class="quizcat__progress-count">${done}/${total}</div>
    </header>
  `;
}

function renderQuestion(messages, index = currentIndex) {
  const question = quizGroup.questions[index];
  const submitted = hasSubmitted(question.id);
  const selected = selectedAnswers[question.id];
  const isLastQuestion = index === quizGroup.questions.length - 1;

  return `
    <p class="quizcat__stem">${renderRichText(question.stem)}</p>
    <div class="quizcat__options" role="list">
      ${getOptions(question)
        .map((option) => renderOption(question, option, selected, submitted))
        .join("")}
    </div>
    ${submitted ? renderFeedback(question, messages) : ""}
    <div class="quizcat__actions quizcat__actions--question">
      ${
        selected !== undefined && !submitted
          ? `<button class="quizcat__button" data-action="submit">${escapeHtml(messages.submit)}</button>`
          : submitted && isLastQuestion
            ? `<button class="quizcat__button" data-action="finish">${escapeHtml(messages.finish)}</button>`
            : submitted
              ? `<button class="quizcat__button" data-action="next">${escapeHtml(messages.next)}</button>`
              : `<span class="quizcat__swipe-hint">${escapeHtml(messages.next)}</span>`
      }
    </div>
  `;
}

function renderOption(question, option, selected, submitted) {
  // For server-side scoring, we get back the correct answer in submittedAnswers
  const submittedEntry = submittedAnswers[question.id];
  const correct = submittedEntry?.correctAnswer;
  const hasKnownCorrect = submitted && correct !== undefined;
  const isSelected = sameAnswer(selected, option.value);
  const isCorrectOption = hasKnownCorrect && sameAnswer(correct, option.value);
  const classes = ["quizcat__option"];

  if (!submitted && isSelected) classes.push("quizcat__option--selected");
  if (submitted && isCorrectOption) classes.push("quizcat__option--correct");
  if (submitted && isSelected && hasKnownCorrect && !isCorrectOption) {
    classes.push("quizcat__option--wrong");
  }

  return `
    <button
      class="${classes.join(" ")}"
      data-action="select"
      data-value="${escapeAttribute(String(option.value))}"
      ${submitted ? "disabled" : ""}
    >
      <span class="quizcat__option-key">${escapeHtml(option.label)}</span>
      <span class="quizcat__option-text">${renderRichText(option.text)}</span>
    </button>
  `;
}

function renderFeedback(question, messages) {
  const submittedEntry = submittedAnswers[question.id];
  if (!submittedEntry) return "";

  const isCorrect = submittedEntry.correct === true;
  const correctAnswer = submittedEntry.correctAnswer;
  const correctText = getAnswerText(question, correctAnswer, messages);

  return `
    <div class="quizcat__feedback">
      <div class="quizcat__feedback-title ${
        isCorrect ? "quizcat__feedback-title--correct" : "quizcat__feedback-title--wrong"
      }">
        ${escapeHtml(isCorrect ? messages.correct : messages.wrong)}
      </div>
      ${
        correctAnswer !== undefined
          ? `<p>${escapeHtml(messages.correctAnswer)}: <strong>${renderRichText(correctText)}</strong></p>`
          : ""
      }
      ${submittedEntry.explanation ? `<p>${renderRichText(submittedEntry.explanation)}</p>` : ""}
    </div>
  `;
}

// === Summary rendering — uses server-returned lastSummary data ===

function renderSummary(messages) {
  const result = lastSummary;
  if (!result || !result.score) {
    return `<div class="quizcat__empty">${escapeHtml(messages.waiting)}</div>`;
  }

  const score = result.score;
  const mistakes = result.mistakes || [];
  const weakTags = result.weakTags || [];

  return `
    <h2 class="quizcat__title">${escapeHtml(messages.summaryTitle)}</h2>
    <div class="quizcat__summary-grid">
      <div class="quizcat__stat">
        <div class="quizcat__stat-value">${score.correctCount} / ${score.totalQuestions}</div>
        <div class="quizcat__stat-label">${escapeHtml(messages.score)}</div>
      </div>
      <div class="quizcat__stat">
        <div class="quizcat__stat-value">${score.accuracy}%</div>
        <div class="quizcat__stat-label">${escapeHtml(messages.accuracy)}</div>
      </div>
      <div class="quizcat__stat">
        <div class="quizcat__stat-value">${score.wrongCount}</div>
        <div class="quizcat__stat-label">${escapeHtml(messages.mistakes)}</div>
      </div>
    </div>

    <h3 class="quizcat__section-title">${escapeHtml(messages.weakAreas)}</h3>
    <div class="quizcat__tags">
      ${
        weakTags.length
          ? weakTags.map((tag) => `<span class="quizcat__tag">${escapeHtml(tag)}</span>`).join("")
          : `<span class="quizcat__pill">${escapeHtml(messages.none)}</span>`
      }
    </div>

    <h3 class="quizcat__section-title">${escapeHtml(messages.mistakes)}</h3>
    <div class="quizcat__mistakes">
      ${
        mistakes.length
          ? mistakes.map((mistake) => renderMistake(mistake, messages)).join("")
          : `
            <div class="quizcat__mistake">
              <strong>${escapeHtml(messages.perfectRun)}</strong>
              <p>${escapeHtml(messages.noMissedQuestions)}</p>
            </div>
          `
      }
    </div>

    <div class="quizcat__actions">
      <button class="quizcat__button quizcat__button--secondary" data-action="restart">
        ${escapeHtml(messages.reviewAgain)}
      </button>
      <button class="quizcat__button" data-action="next-group" ${nextGroupPending ? "disabled" : ""}>
        ${escapeHtml(messages.nextGroup)}
      </button>
    </div>
  `;
}

function renderMistake(mistake, messages) {
  // Server returns stem in the mistake object
  const stem = mistake.stem || mistake.questionId;
  return `
    <article class="quizcat__mistake">
      <strong>${renderRichText(stem)}</strong>
      <p>${escapeHtml(messages.yourAnswer)}: ${renderRichText(mistake.userAnswer || messages.noAnswer)}</p>
      <p>${escapeHtml(messages.correctAnswer)}: ${renderRichText(mistake.correctAnswer || "")}</p>
      ${mistake.explanation ? `<p>${renderRichText(mistake.explanation)}</p>` : ""}
    </article>
  `;
}

// === Events (unchanged from QuizCat) ===

function bindEvents() {
  root.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => {
      const action = element.dataset.action;

      if (action === "select") selectAnswer(element.dataset.value);
      if (action === "submit") submitAnswer();
      if (action === "next") goForward();
      if (action === "go-question") goToQuestion(Number(element.dataset.index));
      if (action === "finish") finishQuiz();
      if (action === "restart") restart();
      if (action === "next-group") requestNextGroup();
    });
  });

  bindSwipe();
}

function selectAnswer(rawValue) {
  if (summaryVisible || navigationLocked) return;

  const question = quizGroup.questions[currentIndex];
  selectedAnswers[question.id] = question.type === "true_false" ? rawValue === "true" : rawValue;

  persistWidgetState();
  render();
}

// === Async submit — calls server API for scoring ===

async function submitAnswer() {
  if (summaryVisible || navigationLocked) return;

  const question = quizGroup.questions[currentIndex];
  const selected = selectedAnswers[question.id];
  if (selected === undefined) return;

  navigationLocked = true;
  render(); // show locked state

  try {
    const result = await submitAnswerAPI(question.id, selected);

    // Store the server response so renderFeedback() can use it
    submittedAnswers[question.id] = {
      userAnswer: selected,
      correct: result.correct,
      correctAnswer: result.correctAnswer,
      explanation: result.explanation,
    };

    persistWidgetState();
    navigationLocked = false;
    render();
  } catch (err) {
    console.error("Submit answer failed:", err);
    navigationLocked = false;
    render();
    // Show error briefly
    alert("Failed to submit answer. Is the server still running?");
  }
}

// === Navigation (unchanged from QuizCat) ===

function goToQuestion(index) {
  if (navigationLocked) return;
  if (!Number.isInteger(index) || index < 0 || index >= quizGroup.questions.length) return;

  if (!summaryVisible && index === currentIndex) {
    render();
    return;
  }

  fadeTo(() => {
    summaryVisible = false;
    currentIndex = index;
    persistWidgetState();
  });
}

function goForward() {
  if (summaryVisible || navigationLocked) return;

  if (currentIndex >= quizGroup.questions.length - 1) {
    if (areAllQuestionsSubmitted()) {
      finishQuiz({ animate: true });
    }
    return;
  }

  fadeTo(() => {
    currentIndex += 1;
    persistWidgetState();
  });
}

function goBack() {
  if (navigationLocked) return;

  if (summaryVisible) {
    fadeTo(() => {
      summaryVisible = false;
      currentIndex = quizGroup.questions.length - 1;
      persistWidgetState();
    });
    return;
  }

  if (currentIndex <= 0) return;

  fadeTo(() => {
    currentIndex -= 1;
    persistWidgetState();
  });
}

function finishQuiz({ animate = false } = {}) {
  // Call the server to finalize (get summary if not already done)
  const showSummary = async () => {
    // If we don't have summary data yet (all answered but no final call),
    // make one more API call with the last answer to trigger final scoring.
    if (!lastSummary) {
      // The last question's answer should have already returned finished:true
      // via submitAnswer. If not, we just show what we have.
    }
    summaryVisible = true;
    persistWidgetState();
  };

  if (animate) {
    fadeTo(() => { showSummary(); });
  } else {
    showSummary();
    renderWithEnterAnimation();
  }
}

function fadeTo(updateState) {
  navigationLocked = true;

  const card = root.querySelector("[data-swipe-card]");
  card?.classList.add("quizcat__card--fade-out");

  window.setTimeout(() => {
    updateState();
    renderWithEnterAnimation();

    window.setTimeout(() => {
      navigationLocked = false;
    }, 190);
  }, 90);
}

function renderWithEnterAnimation() {
  enterAnimation = true;
  render();

  window.setTimeout(() => {
    enterAnimation = false;
    root.querySelector("[data-swipe-card]")?.classList.remove("quizcat__card--fade-in");
  }, 220);
}

// === Swipe (unchanged from QuizCat) ===

function bindSwipe() {
  const card = root.querySelector("[data-swipe-card]");
  if (!card) return;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let dragging = false;
  let pointerId = null;

  card.addEventListener("pointerdown", (event) => {
    if (navigationLocked) return;
    if (event.target.closest("button, textarea, input, select, a")) return;

    startX = event.clientX;
    startY = event.clientY;
    currentX = 0;
    dragging = true;
    pointerId = event.pointerId;

    card.classList.add("quizcat__card--dragging");
    card.setPointerCapture?.(pointerId);
  });

  card.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) return;

    currentX = Math.max(-88, Math.min(88, deltaX));
    card.style.setProperty("--drag-x", `${currentX}px`);
  });

  const finishSwipe = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;

    dragging = false;
    card.classList.remove("quizcat__card--dragging");
    card.style.setProperty("--drag-x", "0px");
    card.releasePointerCapture?.(pointerId);

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (Math.abs(deltaX) >= 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      if (deltaX < 0) {
        goForward();
      } else {
        goBack();
      }
    }
  };

  card.addEventListener("pointerup", finishSwipe);
  card.addEventListener("pointercancel", finishSwipe);
}

// === Restart ===

function restart() {
  navigationLocked = false;
  enterAnimation = false;
  nextGroupPending = false;
  currentIndex = 0;
  selectedAnswers = {};
  submittedAnswers = {};
  summaryVisible = false;

  persistWidgetState();
  render();
}

// === Next Group — calls server API + shows prompt in UI ===

async function requestNextGroup() {
  if (nextGroupPending) return;

  nextGroupPending = true;
  render();

  try {
    const result = await requestNextGroupAPI(locale);
    showNextGroupPrompt(result.prompt);
  } catch (err) {
    console.error("Next group prompt failed:", err);
    alert("Failed to generate next group prompt.");
  } finally {
    nextGroupPending = false;
    render();
  }
}

function showNextGroupPrompt(prompt) {
  // Insert the prompt UI after the summary content inside the card
  const card = root.querySelector("[data-swipe-card]");
  if (!card) return;

  const existing = card.querySelector(".quizcat__prompt-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "quizcat__prompt-modal";
  modal.innerHTML = `
    <h3 class="quizcat__section-title">Next Group Prompt</h3>
    <pre class="quizcat__prompt-text">${escapeHtml(prompt)}</pre>
    <div class="quizcat__actions" style="margin-top:12px">
      <button class="quizcat__button" id="quizcat-copy-prompt">
        Copy to Clipboard
      </button>
    </div>
  `;
  card.appendChild(modal);

  // Bind copy button
  modal.querySelector("#quizcat-copy-prompt")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      const btn = modal.querySelector("#quizcat-copy-prompt");
      if (btn) {
        btn.textContent = "Copied!";
        window.setTimeout(() => { btn.textContent = "Copy to Clipboard"; }, 2000);
      }
    } catch {
      // Fallback: select the text so user can copy manually
      const pre = modal.querySelector(".quizcat__prompt-text");
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  });
}

// === Helpers ===

function areAllQuestionsSubmitted() {
  return quizGroup.questions.every((question) => hasSubmitted(question.id));
}

function getOptions(question) {
  const messages = getMessages(locale);

  if (question.type === "true_false") {
    return [
      { label: "A", text: messages.trueLabel, value: true },
      { label: "B", text: messages.falseLabel, value: false }
    ];
  }

  return (question.options || []).map((option) => ({
    label: option.id,
    text: option.text,
    value: option.id
  }));
}

function getCorrectAnswer(question) {
  if (!question) return undefined;
  // Server-side scoring: the public quiz has no correctOptionId/correctAnswer.
  // We return the correct answer from submittedAnswers if available.
  const entry = submittedAnswers[question.id];
  if (entry) return entry.correctAnswer;
  return undefined;
}

function getAnswerText(question, answer, messages = getMessages(locale)) {
  if (!question || answer === undefined || answer === null) return messages.noAnswer;

  if (question.type === "true_false") {
    const a = answer === true || answer === "true";
    return a ? messages.trueLabel : messages.falseLabel;
  }

  const option = question.options?.find((item) => sameAnswer(item.id, answer));
  return option ? `${option.id}. ${option.text}` : String(answer);
}

function hasSubmitted(questionId) {
  return Object.prototype.hasOwnProperty.call(submittedAnswers, questionId);
}

function sameAnswer(left, right) {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

// === Viewport / height (simplified — no iframe) ===

function syncHostMetrics() {
  const targetHeight = Math.max(
    MIN_WIDGET_HEIGHT,
    Math.min(DEFAULT_WIDGET_HEIGHT, window.innerHeight - 24)
  );
  document.documentElement.style.setProperty("--quizcat-widget-height", `${targetHeight}px`);
}

window.addEventListener("resize", () => {
  syncHostMetrics();
}, { passive: true });

// === Rich-text rendering ===
// Renders a limited safe subset of Markdown/HTML:
//   **bold** / __bold__   → <strong>
//   *italic* / _italic_   → <em>
//   <u>underline</u>      → <u> (passed through)
//   $latex$               → KaTeX inline math
// Everything else is HTML-escaped for safety.

// Sentinel characters for placeholder swaps (outside printable ASCII range)
const MATH = "\x00";
const HTML_TAG = "\x01";

const ALLOWED_HTML = /<\/?u>/gi;

function renderRichText(value) {
  const raw = String(value ?? "");

  // ── 1. Extract and protect inline math ($...$) ──
  const mathPieces: string[] = [];
  const withMathProtected = raw.replace(
    /\$([^$]+)\$/g,
    (_full: string, formula: string) => {
      mathPieces.push(formula);
      return `${MATH}${mathPieces.length - 1}${MATH}`;
    }
  );

  // ── 2. Protect allowed HTML tags (<u>, </u>) ──
  const htmlPieces: string[] = [];
  const withHtmlProtected = withMathProtected.replace(
    ALLOWED_HTML,
    (match: string) => {
      htmlPieces.push(match);
      return `${HTML_TAG}${htmlPieces.length - 1}${HTML_TAG}`;
    }
  );

  // ── 3. Escape everything else ──
  let out = escapeHtml(withHtmlProtected);

  // ── 4. Restore allowed HTML tags ──
  out = out.replace(
    new RegExp(`${HTML_TAG}(\\d+)${HTML_TAG}`, "g"),
    (_: string, i: string) => htmlPieces[Number(i)]!
  );

  // ── 5. Markdown → HTML ──
  // Order matters: ** before * so that **a** doesn't leave stray * markers.
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/_([^_]+)_/g, "<em>$1</em>");

  // ── 6. Render inline math with KaTeX ──
  if (typeof katex !== "undefined" && mathPieces.length > 0) {
    out = out.replace(
      new RegExp(`${MATH}(\\d+)${MATH}`, "g"),
      (_: string, i: string) => {
        const formula = mathPieces[Number(i)]!;
        try {
          return katex.renderToString(formula, {
            throwOnError: false,
            strict: false,
          });
        } catch {
          return `<code>${escapeHtml(formula)}</code>`;
        }
      }
    );
  } else {
    // KaTeX not available — show raw formula
    out = out.replace(
      new RegExp(`${MATH}(\\d+)${MATH}`, "g"),
      (_: string, i: string) =>
        `<code>${escapeHtml(mathPieces[Number(i)]!)}</code>`
    );
  }

  return out;
}

// === HTML escape (plain, no rich formatting) ===

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
