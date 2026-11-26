import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3100);
const GATEWAY_URL = (process.env.GATEWAY_URL || "http://127.0.0.1:18789").replace(/\/$/, "");
const TOKEN = process.env.GATEWAY_TOKEN;

if (!TOKEN) {
  console.error("Missing GATEWAY_TOKEN environment variable");
  process.exit(1);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = await fs.readFile(path.join(__dirname, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      const r = await fetch(`${GATEWAY_URL}/healthz`);
      sendJson(res, r.ok ? 200 : 502, { gateway: r.ok ? "live" : "down" });
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const { message, conversationId } = JSON.parse(await readBody(req));
      if (!message || typeof message !== "string") {
        sendJson(res, 400, { error: "message is required" });
        return;
      }

      const controller = new AbortController();
      res.on("close", () => controller.abort());

      const upstream = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openclaw/default",
          stream: true,
          user: `webapp:${conversationId || "default"}`,
          messages: [{ role: "user", content: message }],
        }),
        signal: controller.signal,
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        sendJson(res, upstream.status, { error: `Gateway returned ${upstream.status}: ${text.slice(0, 500)}` });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 502, { error: String(err.message || err) });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Web App running at http://localhost:${PORT}  ->  Gateway ${GATEWAY_URL}`);
});
