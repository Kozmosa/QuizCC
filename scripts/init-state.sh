#!/bin/bash
# QuizCC session state initialization
# Creates the state directory for quiz sessions.

STATE_DIR="${CLAUDE_PROJECT_DIR}/.claude/quizcc"
mkdir -p "$STATE_DIR"
echo "QuizCC session state ready: $STATE_DIR"
