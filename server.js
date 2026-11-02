
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;
const PASSWORD = process.env.JARVIS_LOGIN_PASSWORD;
const SESSION_SECRET = process.env.JARVIS_SESSION_SECRET;
const API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const HTML_FILE = path.join(__dirname, "Index.html");
const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 20 * 1024;
const sessions = new Map();
const loginAttempts = new Map();
const chatAttempts = new Map();

async function askGemini(message) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: message }]
          }]
        }),
        signal: AbortSignal.timeout(30000)
      });

      const result = await response.json();

      if (!response.ok) {
        const error = new Error(
          result.error?.message || "Gemini request failed"
        );
        error.status = response.status;
        throw error;
      }

      const reply =
        result.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

      if (!reply) {
        throw new Error("Gemini returned an empty response");
      }

      return reply;

    } catch (error) {
      lastError = error;

      const retryable =
        !error.status ||
        [429, 500, 502, 503, 504].includes(error.status);

      console.error(
        `Gemini attempt ${attempt}/3 failed:`,
        error.message
      );

      if (!retryable || attempt === 3) break;

      await new Promise(resolve =>
        setTimeout(resolve, 1000 * (2 ** (attempt - 1)))
      );
    }
  }

  throw lastError || new Error("Gemini unavailable");
}
