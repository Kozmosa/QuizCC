# QuizCC — Interactive Terminal Quizzes for Claude Code

QuizCC brings interactive quiz experiences to Claude Code. Ask Claude to quiz you on any topic, answer questions directly in the terminal, get instant feedback with explanations, and see your score with weak area analysis.

## Features

- **Single-choice** (2-4 options, A/B/C/D) and **True/False** questions
- **Four difficulty levels**: easy, medium, hard, insane
- **Instant feedback**: correct/wrong with explanations for every question
- **Score summary**: accuracy, weak areas (tag-based analysis), and mistake review
- **Next group generation**: automatically generates follow-up quizzes targeting weak areas
- **Multi-language**: English, Simplified Chinese, and Japanese prompt support
- **Zero widget dependencies**: all interaction happens in the terminal conversation

## Quick Start

QuizCC runs as a Claude Code plugin. Once installed, just type:

```
/quiz machine learning
```

Claude will generate quiz questions on the topic, and you answer by typing `A`, `B`, `C`, `D`, `True`, or `False`.

## Installation

1. Clone the repository:
   ```bash
   git clone git@github.com:Kozmosa/QuizCC.git
   ```

2. Install dependencies:
   ```bash
   cd QuizCC
   npm install
   ```

3. Add to Claude Code by pointing the plugin discovery to QuizCC's directory.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Claude Code                      │
│  /quiz [topic]  ──▶  generates quiz JSON          │
│                         │                         │
│                         ▼                         │
│           MCP Server (STDIO)                       │
│  ┌─────────────────────────────────────────────┐  │
│  │ start_quiz     │ validate + session + Q1    │  │
│  │ submit_answer  │ score + feedback + next Q  │  │
│  │ get_quiz_state │ progress query             │  │
│  │ get_next_group │ weak-area prompt gen       │  │
│  └─────────────────────────────────────────────┘  │
│                         │                         │
│                         ▼                         │
│              .claude/quizcc/<session>.json        │
│              (filesystem state)                   │
└─────────────────────────────────────────────────┘
```

### Packages

| Module | Path | Description |
|--------|------|-------------|
| Core Types | `src/core/types.ts` | TypeScript types, constants, guard functions |
| Validation | `src/core/validation.ts` | Quiz normalization, public/private answer separation |
| Scoring | `src/core/scoring.ts` | Answer scoring, weak tag analysis |
| Next Group | `src/core/next-group.ts` | Multi-language next-quiz prompt generation |
| MCP Server | `src/mcp/server.ts` | STDIO MCP server (McpServer + StdioServerTransport) |
| MCP Tools | `src/mcp/tools.ts` | 4 tool handlers + Markdown formatters |
| State | `src/state/session-state.ts` | Filesystem-based quiz session persistence |

### Ported from QuizCat

QuizCC is a complete rewrite of [QuizCat](https://github.com/Kozmosa/QuizCat) (a ChatGPT Apps quiz card application) for Claude Code. The core quiz logic (`@quizcat/core`) is directly ported with 90%+ code reuse. The widget layer is replaced by terminal Markdown interaction, and the MCP transport is switched from HTTP to STDIO.

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Type check
npm run typecheck

# Run MCP server (for testing)
npm run dev
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `start_quiz` | Validates a quiz group, creates a session, returns Q1 as Markdown |
| `submit_answer` | Scores user answer, returns feedback + next question or final summary |
| `get_quiz_state` | Returns current quiz progress |
| `get_next_group_prompt` | Generates LLM prompt for next quiz targeting weak areas |

## Security

- Correct answers are stored server-side in `_meta` and never displayed to the user before answering
- The public quiz group returned in `structuredContent` contains no answer keys
- `submit_answer` handles all scoring server-side — Claude cannot accidentally leak answers
- Quiz session files are automatically deleted upon completion

## License

MIT
