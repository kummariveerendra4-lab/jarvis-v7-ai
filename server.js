
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const OpenAI = require("openai");

const PORT = process.env.PORT || 10000;
const PASSWORD = process.env.JARVIS_LOGIN_PASSWORD;
const SESSION_SECRET = process.env.JARVIS_SESSION_SECRET;
const API_KEY = process.env.OPENAI_API_KEY;

const HTML_FILE = path.join(__dirname, "Index.html");
const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 20 * 1024;

const sessions = new Map();
const loginAttempts = new Map();
const chatAttempts = new Map();

let client = null;

if (API_KEY) {
  client = new OpenAI({ apiKey: API_KEY });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = url.pathname;

  function send(status, data, type = "application/json") {
    res.writeHead(status, {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store"
    });
    res.end(data);
  }

  function json(status, data) {
    send(status, JSON.stringify(data));
  }

  function readBody() {
    return new Promise((resolve, reject) => {
      let body = "";
      let size = 0;

      req.on("data", chunk => {
        size += chunk.length;

        if (size > MAX_BODY) {
          reject(new Error("BODY_TOO_LARGE"));
          req.destroy();
          return;
        }

        body += chunk.toString("utf8");
      });

      req.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}"));
        } catch {
          reject(new Error("INVALID_JSON"));
        }
      });

      req.on("error", reject);
    });
  }

  function getSession() {
    const cookies = (req.headers.cookie || "")
      .split(";")
      .map(item => item.trim());

    const item = cookies.find(value =>
      value.startsWith("jarvis_session=")
    );

    if (!item) return false;

    const token = item.slice("jarvis_session=".length);
    const expiry = sessions.get(token);

    if (!expiry || expiry < Date.now()) {
      sessions.delete(token);
      return false;
    }

    return token;
  }

  function setCookie(token) {
    res.setHeader(
      "Set-Cookie",
      "jarvis_session=" + token +
      "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800"
    );
  }

  function clearCookie() {
    res.setHeader(
      "Set-Cookie",
      "jarvis_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
    );
  }

  function rateLimited(store, key, limit, windowMs) {
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
    }

    entry.count++;
    store.set(key, entry);

    return entry.count > limit;
  }

  function clientKey() {
    // Basic per-process limiting. Behind a proxy, this address
    // may represent a proxy rather than an individual visitor.
    return req.socket.remoteAddress || "unknown";
  }

  function requireSameOrigin() {
    const origin = req.headers.origin;

    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          json(403, { error: "Origin not allowed" });
          return false;
        }
      } catch {
        json(403, { error: "Invalid origin" });
        return false;
      }
    }

    if (req.headers["sec-fetch-site"] === "cross-site") {
      json(403, { error: "Cross-site request blocked" });
      return false;
    }

    return true;
  }

  try {
    // Health information only; never reveal secrets.
    if (req.method === "GET" && route === "/health") {
      return json(200, {
        status: "ok",
        assistant: "JARVIS V7",
        loginConfigured: Boolean(PASSWORD && SESSION_SECRET),
        aiConfigured: Boolean(API_KEY)
      });
    }

    // Login page
    if (req.method === "GET" && route === "/login") {
      const loginHTML = `<!doctype html>
<html lang="en">
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta charset="utf-8">
<title>JARVIS V7 Login</title>
<style>
body{font-family:Arial,sans-serif;background:#08111f;color:#fff;
display:grid;place-items:center;min-height:100vh;margin:0}
main{width:85%;max-width:360px;background:#142238;padding:24px;
border-radius:16px}
input,button{box-sizing:border-box;width:100%;padding:14px;
margin-top:12px;border-radius:8px;font-size:16px}
button{background:#1688ff;color:white;border:0}
p{color:#ff9a9a;overflow-wrap:anywhere}
</style>
</head>
<body><main>
<h1>JARVIS V7</h1><p>Private access</p>
<form id="login">
<input id="password" type="password" autocomplete="current-password"
placeholder="Enter your password" required maxlength="256">
<button type="submit">Sign in</button>
<p id="message" role="alert"></p>
</form>
<script>
document.getElementById("login").addEventListener("submit",
async function(e){
e.preventDefault();
const message=document.getElementById("message");
message.textContent="Checking...";
try{
const r=await fetch("/login",{method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({
password:document.getElementById("password").value
})});
const d=await r.json();
if(!r.ok) throw new Error(d.error||"Login failed");
location.replace("/");
}catch(err){message.textContent=err.message;}
});
</script>
</main></body></html>`;

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer"
      });
      return res.end(loginHTML);
    }

    // Create a private session after password verification.
    if (req.method === "POST" && route === "/login") {
      if (!requireSameOrigin()) return;

      if (!PASSWORD || !SESSION_SECRET ||
          SESSION_SECRET.length < 64) {
        return json(503, {
          error: "Login is not configured correctly"
        });
      }

      if (rateLimited(loginAttempts, clientKey(), 5, 15 * 60 * 1000)) {
        return json(429, {
          error: "Too many login attempts. Try again later."
        });
      }

      const data = await readBody();
      const supplied = typeof data.password === "string"
        ? data.password : "";

      const suppliedBuffer = Buffer.from(supplied);
      const expectedBuffer = Buffer.from(PASSWORD);

      const valid = suppliedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);

      if (!valid) {
        return json(401, { error: "Incorrect password" });
      }

      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, Date.now() + SESSION_MS);
      setCookie(token);

      return json(200, { ok: true });
    }

    // Log out and invalidate the current session.
    if (req.method === "POST" && route === "/logout") {
      if (!requireSameOrigin()) return;

      const token = getSession();
      if (token) sessions.delete(token);

      clearCookie();
      return json(200, { ok: true });
    }

    // All remaining private routes require a valid session.
    const token = getSession();

    if (!token) {
      if (route === "/" && req.method === "GET") {
        res.writeHead(302, {
          Location: "/login",
          "Cache-Control": "no-store"
        });
        return res.end();
      }

      return json(401, { error: "Please log in first" });
    }

    // Private homepage
    if (req.method === "GET" && route === "/") {
      return fs.readFile(HTML_FILE, "utf8", (err, html) => {
        if (err) {
          console.error("Homepage read failed");
          return json(500, { error: "Could not load Index.html" });
        }

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer"
        });
        res.end(html);
      });
    }

    // Private AI endpoint
    if (req.method === "POST" && route === "/chat") {
      if (!requireSameOrigin()) return;

      if (rateLimited(chatAttempts, token, 20, 60 * 1000)) {
        return json(429, {
          error: "Too many messages. Wait a minute and try again."
        });
      }

      if (!client) {
        return json(503, { error: "AI service is not configured" });
      }

      const data = await readBody();
      const message = data.message;

      if (typeof message !== "string" ||
          !message.trim() || message.length > 8000) {
        return json(400, {
          error: "Enter a message of up to 8000 characters"
        });
      }

      const response = await client.responses.create({
        model: "gpt-5.5",
        input: message.trim()
      });

      return json(200, { reply: response.output_text });
    }

    return json(404, { error: "Not found" });

  } catch (error) {
    if (res.destroyed || res.writableEnded) return;

    if (error.message === "BODY_TOO_LARGE") {
      return json(413, { error: "Request too large" });
    }

    if (error.message === "INVALID_JSON") {
      return json(400, { error: "Invalid JSON" });
    }

    // Do not send internal error details to the browser.
    console.error("Request failed:", error.message);
    return json(500, { error: "Request failed. Check server logs." });
  }
});

if (!PASSWORD || !SESSION_SECRET || SESSION_SECRET.length < 64) {
  console.error("Missing login secrets or session secret is too short.");
}

server.listen(PORT, "0.0.0.0", () => {
  console.log("JARVIS V7 running on port " + PORT);
});

