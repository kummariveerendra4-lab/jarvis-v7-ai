
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.GEMINI_API_KEY;
const HTML_FILE = path.join(__dirname, "Index.html");

const server = http.createServer(async (req, res) => {
  const pathname = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  ).pathname;

  console.log("REQUEST:", req.method, pathname);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      status: "ok",
      assistant: "JARVIS V7",
      aiConfigured: Boolean(process.env.GEMINI_API_KEY)
    }));
  }

  if (req.method === "GET" && pathname === "/") {
    return fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        console.error("HTML READ ERROR:", err.message);
        res.writeHead(500, { "Content-Type": "text/plain" });
        return res.end("Could not load Index.html. Check the filename.");
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
  }

  if (req.method === "POST" && pathname === "/chat") {
    if (!process.env.GEMINI_API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        error: "GEMINI_API_KEY is missing in Render Environment."
      }));
    }

    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100000) req.destroy();
    });

    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body);
        const message = parsed.message;

        if (typeof message !== "string" || !message.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            error: "Please send a non-empty message."
          }));
        }

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": process.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: message.trim() }]
              }]
            })
          }
        );

        const result = await response.json();

        if (!response.ok) {
          console.error("GEMINI API ERROR:", response.status,
            JSON.stringify(result).slice(0, 1500));

          res.writeHead(502, {
            "Content-Type": "application/json"
          });
          return res.end(JSON.stringify({
            error: result.error?.message || "Gemini API request failed."
          }));
        }

        const reply = result.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

        if (!reply) {
          res.writeHead(502, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            error: "Gemini returned no text."
          }));
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply }));

      } catch (err) {
        console.error("CHAT ERROR:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Chat failed. Check Render logs."
          }));
        }
      }
    });

    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: "Not found",
    path: pathname
  }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`JARVIS V7 running on port ${PORT}`);
  console.log("Gemini API key configured:",
    Boolean(process.env.GEMINI_API_KEY));
});
