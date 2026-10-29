
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 10000;
const HTML_FILE = path.join(__dirname, "Index.html");

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function askGemini(message) {
  let lastError = "Gemini request failed.";

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: message }]
          }]
        }),
        signal: AbortSignal.timeout(30000)
      });

      const result = await response.json();

      if (response.ok) {
        const reply = result.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

        if (!reply) {
          throw new Error("Gemini returned no text.");
        }

        return reply;
      }

      lastError = result.error?.message ||
        `Gemini API error (${response.status}).`;

      console.error(
        "GEMINI API ERROR:",
        response.status,
        lastError
      );

      // Retry only temporary server errors.
      if (![500, 502, 503, 504].includes(response.status)) {
        throw new Error(lastError);
      }

    } catch (err) {
      lastError = err.message || "Network request failed.";

      if (err.name === "AbortError" ||
          err.name === "TimeoutError") {
        lastError = "Gemini request timed out.";
      }

      console.error(
        `Gemini attempt ${attempt}/3 failed:`,
        lastError
      );

      // Do not retry ordinary API errors or an empty response.
      if (
        err.message === "Gemini returned no text." ||
        (err.message && !err.name &&
         !lastError.startsWith("fetch failed") &&
         !lastError.includes("timed out") &&
         !lastError.includes("Network"))
      ) {
        throw err;
      }
    }

    if (attempt < 3) {
      await sleep(1000);
    }
  }

  throw new Error(
    "Gemini is temporarily unavailable after 3 attempts. " +
    lastError
  );
}

const server = http.createServer(async (req, res) => {
  let pathname;

  try {
    pathname = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    ).pathname;
  } catch {
    res.writeHead(400, {
      "Content-Type": "application/json"
    });
    return res.end(JSON.stringify({
      error: "Invalid request URL."
    }));
  }

  console.log("REQUEST:", req.method, pathname);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

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
        res.writeHead(500, {
          "Content-Type": "text/plain"
        });
        return res.end(
          "Could not load Index.html. Check the filename."
        );
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });
      res.end(data);
    });
  }

  if (req.method === "POST" && pathname === "/chat") {
    if (!process.env.GEMINI_API_KEY) {
      res.writeHead(500, {
        "Content-Type": "application/json"
      });
      return res.end(JSON.stringify({
        error: "GEMINI_API_KEY is missing in Render Environment."
      }));
    }

    let body = "";
    let tooLarge = false;

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 100000 && !tooLarge) {
        tooLarge = true;
        res.writeHead(413, {
          "Content-Type": "application/json"
        });
        res.end(JSON.stringify({
          error: "Message is too large."
        }));
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (tooLarge || res.destroyed || res.writableEnded) {
        return;
      }

      try {
        const parsed = JSON.parse(body);
        const message = parsed.message;

        if (
          typeof message !== "string" ||
          !message.trim()
        ) {
          res.writeHead(400, {
            "Content-Type": "application/json"
          });
          return res.end(JSON.stringify({
            error: "Please send a non-empty message."
          }));
        }

        const reply = await askGemini(message.trim());

        if (res.destroyed || res.writableEnded) return;

        res.writeHead(200, {
          "Content-Type": "application/json"
        });
        res.end(JSON.stringify({ reply }));

      } catch (err) {
        console.error("CHAT ERROR:", err.message);

        if (res.destroyed || res.writableEnded) return;

        const isBadJson = err instanceof SyntaxError;
        const isServiceError =
          err.message.includes("temporarily unavailable");

        res.writeHead(
          isBadJson ? 400 : isServiceError ? 503 : 502,
          { "Content-Type": "application/json" }
        );

        res.end(JSON.stringify({
          error: isBadJson
            ? "Invalid JSON request."
            : err.message || "Chat failed. Check Render logs."
        }));
      }
    });

    return;
  }

  res.writeHead(404, {
    "Content-Type": "application/json"
  });
  res.end(JSON.stringify({
    error: "Not found",
    path: pathname
  }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`JARVIS V7 running on port ${PORT}`);
  console.log(
    "Gemini API key configured:",
    Boolean(process.env.GEMINI_API_KEY)
  );
});
