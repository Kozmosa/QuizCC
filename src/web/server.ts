import { createServer } from "node:http";
import { handleRequest } from "./routes.js";

const PORT = parseInt(process.env.QUIZCC_WEB_PORT || "3456", 10);
const HOST = process.env.QUIZCC_WEB_HOST || "127.0.0.1";

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("Unhandled request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. The QuizCC web server may already be running.`
    );
    process.exit(1);
  }
  console.error("Server error:", err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.error(`QuizCC Web Server running on http://${HOST}:${PORT}`);
  console.error(`Widget: http://${HOST}:${PORT}/widget/index.html`);
  console.error(`API:    http://${HOST}:${PORT}/api/session/:id`);
});

// Graceful shutdown
function shutdown() {
  console.error("\nShutting down QuizCC Web Server...");
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
