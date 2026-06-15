---
description: Start an interactive quiz on any topic
argument-hint: [topic]
allowed-tools: mcp__quizcc_quizcc-server__start_quiz, mcp__quizcc_quizcc-server__submit_answer, mcp__quizcc_quizcc-server__get_quiz_state, mcp__quizcc_quizcc-server__get_next_group_prompt
---

# /quiz — Interactive Terminal Quiz

Start an interactive quiz session on $ARGUMENTS.

## Overview

You are orchestrating an interactive quiz experience. The flow has four phases:

1. **Generate** — Create quiz questions as JSON
2. **Start** — Call `start_quiz` to validate and begin
3. **Loop** — Call `submit_answer` for each user response, showing feedback and advancing
4. **Finish** — Show the final summary and offer continuation

## Phase 1: Determine Topic & Parameters

If $ARGUMENTS is empty, ask the user:

1. **What topic would you like to be quizzed on?**
2. **Difficulty level?** (easy / medium / hard / insane) — default: medium
3. **How many questions?** (3 / 5 / 7 / 10) — default: 5

If $ARGUMENTS is provided, use it as the topic. Assume medium difficulty and 5 questions unless the user specifies otherwise in their message.

## Phase 2: Generate Quiz Content

Generate a quiz group in JSON format matching this schema:

```json
{
  "title": "A descriptive title for the quiz",
  "topic": "The subject area",
  "difficulty": "medium",
  "questions": [
    {
      "type": "single_choice",
      "stem": "The question text (1-1000 chars)",
      "options": [
        { "id": "A", "text": "First option" },
        { "id": "B", "text": "Second option" },
        { "id": "C", "text": "Third option" },
        { "id": "D", "text": "Fourth option" }
      ],
      "correctOptionId": "A",
      "explanation": "Why this is correct (optional, up to 1500 chars)",
      "tags": ["knowledge-area-1", "knowledge-area-2"]
    },
    {
      "type": "true_false",
      "stem": "A statement the user must judge as true or false.",
      "correctAnswer": true,
      "explanation": "Why this statement is true or false (optional)",
      "tags": ["concept-name"]
    }
  ]
}
```

### Guidelines for generating good quiz content:

- **single_choice questions**: Must have 2-4 options. Exactly one is correct. Options should be plausible distractors.
- **true_false questions**: A clear, unambiguous statement. Avoid trick wording.
- **Tags**: 1-8 tags per question describing knowledge areas. Tags help identify weak areas.
- **Explanations**: Explain WHY the answer is correct. This is crucial for learning.
- **Difficulty**: Match the requested difficulty level. "hard" and "insane" should require deep knowledge.
- **Avoid overlap**: Don't reuse the same stem or options across questions in the same group.
- **Text formatting**: Use limited Markdown in stems, options, and explanations:
  - `**bold**` for key terms or emphasis
  - `*italic*` for definitions or foreign terms
  - `<u>underline</u>` for critical points
  - `$formula$` for **ALL mathematical notation** — always wrap math in single dollar signs (e.g., `$E = mc^2$`, `$O(n \log n)$`, `$\int_0^\infty f(x)dx$`). Never use raw Unicode math or double dollar signs. The web UI renders `$...$` as KaTeX.

## Phase 3: Start the Quiz

Call the MCP tool `start_quiz` with the generated quiz group:

```
Tool: mcp__quizcc_quizcc-server__start_quiz
Input: { "quizGroup": { ... the generated quiz ... } }
```

If the tool returns a validation error, fix the quiz data and retry.

On success, the tool returns:
- Markdown content displaying the first question (display this to the user directly)
- `_meta.sessionId` (keep this — you'll need it for subsequent calls)
- `_meta.quizGroup` (the full quiz with answers — keep private)

**Display the returned Markdown exactly as provided.** It is already formatted for terminal display.

## Phase 4: Interactive Answer Loop

The user will type their answer (A, B, C, D, True, or False). For each answer:

1. Call `submit_answer`:
   ```
   Tool: mcp__quizcc_quizcc-server__submit_answer
   Input: { "sessionId": "<sessionId from _meta>", "answer": "<user's input>" }
   ```

2. The tool returns:
   - Feedback (correct/wrong with explanation)
   - If `finished: false` — the next question formatted as Markdown
   - If `finished: true` — the final score summary

3. **Display the returned Markdown content directly.** Do not modify it.

4. Continue until `finished: true`.

### IMPORTANT: Do NOT reveal answers

- The `_meta.quizGroup` contains correct answers — these are for scoring only.
- Never display the correct answer BEFORE the user answers.
- Let the `submit_answer` tool handle all feedback — it knows the correct answers.

## Phase 5: Completion & Continuation

After `finished: true`, the final summary is displayed automatically by the tool output.

Ask the user: **"Would you like another quiz on this topic? I can focus on your weak areas."**

If yes:
1. Call `get_next_group_prompt` with the sessionId and the user's preferred locale
2. Use the returned prompt to guide your generation of the next quiz group
3. Focus on the weak areas identified in the previous quiz
4. **Do NOT reuse any previous question stems, options, or IDs**
5. Generate a brand-new quiz and call `start_quiz` again

## Error Handling

- If `submit_answer` returns `isError: true` (e.g., session expired), tell the user and offer to start a new quiz.
- If validation fails on `start_quiz`, read the `issues` array in the error and fix the quiz data.
- The answer normalizer is forgiving: "A", "a", "A)", "True", "true", "TRUE", "yes", "y" all work.

## Example Interaction

```
User: /quiz machine learning

You: [Generate 5 medium-difficulty ML questions]
     [Call start_quiz]

# Machine Learning Fundamentals
**Difficulty:** medium | **Question 1/5**

---

## Q1: What type of learning uses labeled training data?

A) Unsupervised learning
B) Supervised learning
C) Reinforcement learning
D) Semi-supervised learning

---

Type **A**, **B**, **C**, or **D** to answer.

User: B

You: [Call submit_answer with sessionId and answer "B"]

✅ **Correct!** The answer is B) Supervised learning.

> Supervised learning uses labeled input-output pairs to train models.

---

## Q2: True or false: Decision trees are immune to feature scaling.

---

Type **True** or **False** to answer.

... (continues for all questions) ...

# Quiz Complete: Machine Learning Fundamentals

**Score:** 4/5 (80.0%)

**Weak Areas:** regularization, decision trees

## Mistakes
- **Q3: What technique adds a penalty term to the loss function?**
  Your answer: Dropout. Correct: D) L2 regularization
  > L2 regularization adds λ‖w‖² to the loss function to penalize large weights.

---

Would you like another quiz on this topic? I can focus on your weak areas.
```

## Web Mode (`--web` flag)

When the user passes `--web` (e.g., `/quiz --web machine learning`), do NOT run the terminal answer loop. Instead, launch the web UI:

### Step 1: Generate + Start Quiz

1. Generate the quiz JSON and call `start_quiz` exactly as in normal mode.
2. Extract the `sessionId` from `start_quiz`'s `_meta.sessionId`.

### Step 2: Start the Web Server

Start the web server as a background task (if not already running):

```bash
npx tsx src/web/server.ts &
```

If port 3456 is already in use, the server may already be running — that's fine, continue.

### Step 3: Show the URL

Tell the user:

> 🎮 **Quiz ready!** Open this in your browser:
> http://localhost:3456/?session=<sessionId>
>
> Answer the questions in the web UI. When you're done, click "Next Group" and paste the prompt back here for another quiz.

### Step 4: Wait for Next Group

Do NOT continue the interactive loop in the terminal. Wait for the user to finish in the browser and paste the next-group prompt back. When they do, generate the new quiz and call `start_quiz` again with a new session.

### Web Mode Notes

- The web server serves on `http://localhost:3456` by default
- Session state is shared between MCP and web via `.claude/quizcc/` files
- The web UI has the same interactive card UI as QuizCat (ChatGPT version)
- Answers are scored server-side — the browser never sees correct answers
