
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Keep your exact requested environment-variable name.
const GEMINI_API_KEY = process.env['GEMINI API KEY'];

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const server = http.createServer(async (req, res) => {
    console.log('REQUEST:', req.method, req.url);

    // Common response headers
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // HOME PAGE
    if (req.method === 'GET' && req.url === '/') {
        const filePath = path.join(__dirname, 'Index.html');

        fs.readFile(filePath, 'utf8', (err, html) => {
            if (err) {
                console.error('HTML READ ERROR:', err.message);

                res.writeHead(500, {
                    'Content-Type': 'text/plain; charset=utf-8'
                });
                res.end('Could not load Index.html. Check the filename.');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8'
            });
            res.end(html);
        });

        return;
    }

    // HEALTH CHECK
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8'
        });

        res.end(JSON.stringify({
            status: 'ok',
            assistant: 'JARVIS V7',
            aiConfigured: Boolean(GEMINI_API_KEY),
            provider: 'Google Gemini'
        }));

        return;
    }

    // AI CHAT
    if (req.method === 'POST' && req.url === '/chat') {
        if (!GEMINI_API_KEY) {
            res.writeHead(503, {
                'Content-Type': 'application/json; charset=utf-8'
            });
            res.end(JSON.stringify({
                error: 'Gemini API key is not configured in Render.'
            }));
            return;
        }

        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 100000) {
                res.writeHead(413, {
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify({
                    error: 'Message is too large.'
                }));
                req.destroy();
            }
        });

        req.on('end', async () => {
            if (res.writableEnded || req.destroyed) return;

            try {
                const data = JSON.parse(body);
                const message = data.message;

                if (
                    typeof message !== 'string' ||
                    !message.trim()
                ) {
                    res.writeHead(400, {
                        'Content-Type': 'application/json; charset=utf-8'
                    });
                    res.end(JSON.stringify({
                        error: 'Please provide a message.'
                    }));
                    return;
                }

                const response = await fetch(GEMINI_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': GEMINI_API_KEY
                    },
                    body: JSON.stringify({
                        contents: [{
                            role: 'user',
                            parts: [{
                                text: message.trim()
                            }]
                        }],
                        systemInstruction: {
                            parts: [{
                                text:
                                    'You are JARVIS V7, a helpful AI assistant. ' +
                                    'Answer clearly, accurately, and politely. ' +
                                    'Explain difficult topics in simple language.'
                            }]
                        },
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: 2048
                        }
                    })
                });

                const result = await response.json();

                if (!response.ok) {
                    console.error(
                        'GEMINI API ERROR:',
                        response.status,
                        JSON.stringify(result)
                    );

                    res.writeHead(502, {
                        'Content-Type': 'application/json; charset=utf-8'
                    });
                    res.end(JSON.stringify({
                        error: 'Gemini request failed.',
                        details:
                            result.error?.message ||
                            `Gemini returned HTTP ${response.status}.`
                    }));
                    return;
                }

                const reply = (result.candidates?.[0]?.content?.parts || [])
                    .map(part => part.text || '')
                    .join('')
                    .trim();

                if (!reply) {
                    console.error(
                        'Gemini returned no text:',
                        JSON.stringify(result)
                    );

                    res.writeHead(502, {
                        'Content-Type': 'application/json; charset=utf-8'
                    });
                    res.end(JSON.stringify({
                        error: 'Gemini returned an empty response.'
                    }));
                    return;
                }

                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8'
                });

                res.end(JSON.stringify({
                    reply: reply
                }));

            } catch (error) {
                console.error('CHAT ERROR:', error.message);

                if (!res.headersSent) {
                    res.writeHead(500, {
                        'Content-Type': 'application/json; charset=utf-8'
                    });

                    res.end(JSON.stringify({
                        error: 'JARVIS could not process the request.',
                        details:
                            error instanceof SyntaxError
                                ? 'Invalid JSON received.'
                                : 'Check the Render logs.'
                    }));
                }
            }
        });

        req.on('error', error => {
            console.error('REQUEST ERROR:', error.message);
        });

        return;
    }

    // UNKNOWN ROUTE
    res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8'
    });

    res.end(JSON.stringify({
        error: 'Not found',
        availableRoutes: ['/', '/health', '/chat']
    }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS V7 running on port ${PORT}`);
    console.log(
        'Gemini API key configured:',
        Boolean(GEMINI_API_KEY)
    );
});
