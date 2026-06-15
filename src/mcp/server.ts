import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  startQuizInputSchema,
  submitAnswerInputSchema,
  getQuizStateInputSchema,
  getNextGroupPromptInputSchema,
} from "./schemas.js";
import {
  handleStartQuiz,
  handleSubmitAnswer,
  handleGetQuizState,
  handleGetNextGroupPrompt,
} from "./tools.js";

// === Server setup ===

const server = new McpServer({
  name: "quizcc-server",
  version: "1.0.0",
});

// === Tool registrations ===

server.registerTool(
  "start_quiz",
  {
    title: "Start QuizCC Quiz",
    description:
      "Start a new interactive quiz session. Provide a quiz group with single_choice and/or true_false questions. The tool validates the quiz, stores the session, and returns the first question formatted as Markdown.",
    inputSchema: startQuizInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  async (args) => {
    return handleStartQuiz(args);
  }
);

server.registerTool(
  "submit_answer",
  {
    title: "Submit Quiz Answer",
    description:
      "Submit an answer for the current quiz question. Returns immediate feedback (correct/wrong with explanation), then either advances to the next question or shows the final score summary. Accepts single letters (A/B/C/D) for single_choice or true/false for boolean questions.",
    inputSchema: submitAnswerInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
  },
  async (args) => {
    return handleSubmitAnswer(args);
  }
);

server.registerTool(
  "get_quiz_state",
  {
    title: "Get Quiz State",
    description:
      "Retrieve the current state of an active quiz session, including progress and answered questions.",
    inputSchema: getQuizStateInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  async (args) => {
    return handleGetQuizState(args);
  }
);

server.registerTool(
  "get_next_group_prompt",
  {
    title: "Get Next Group Prompt",
    description:
      "Generate a prompt for creating the next quiz group based on the user's performance. The prompt includes weak areas, missed questions, and instructions to avoid reusing previous content. Use this after a quiz is completed to generate a follow-up quiz targeting weak areas.",
    inputSchema: getNextGroupPromptInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  async (args) => {
    return handleGetNextGroupPrompt(args);
  }
);

// === Main ===

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with STDIO protocol
  console.error("QuizCC MCP Server running on stdio");
}

main().catch((error: unknown) => {
  console.error("Fatal error starting QuizCC server:", error);
  process.exit(1);
});
