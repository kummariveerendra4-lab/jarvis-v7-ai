
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

function getGeminiKey() {
    return process.env.GEMINI_API_KEY;
}

const server = http.createServer((req, res) => {
    console.log('REQUEST:', req.method, req.url);

    // Homepage
    if (req.method === 'GET' && req.url === '/') {
        const filePath = path.join(__dirname, 'Index.html');

        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                console.error('HTML READ ERROR:', err.message);

                res.writeHead(500, {
                    'Content-Type': 'text/plain; charset=utf-8'
                });
                res.end('Could not load Index.html');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8'
            });
            res.end(data);
        });

        return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, {
            'Content-Type': 'application/json'
        });

        res.end(JSON.stringify({
            status: 'ok',
            assistant: 'JARVIS V7',
            aiConfigured: Boolean(getGeminiKey())
        }));

        return;
    }

    // Gemini AI chat
    if (req.method === 'POST' && req.url === '/chat') {
        let body = '';
        let tooLarge = false;

        req.on('data', chunk => {
            if (tooLarge) return;

            body += chunk.toString();

            if (body.length > 100000) {
                tooLarge = true;

                res.writeHead(413, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    error: 'Message is too large'
                }));
            }
        });

        req.on('end', async () => {
            if (tooLarge || res.writableEnded) return;

            try {
                const data = JSON.parse(body);
                const message = data.message;

                if (typeof message !== 'string' ||
                    !message.trim()) {
                    res.writeHead(400, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: 'Message is required'
                    }));
                    return;
                }

                const apiKey = getGeminiKey();

                if (!apiKey) {
                    res.writeHead(503, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: 'Gemini API key is not configured in Render'
                    }));
                    return;
                }

                const response = await fetch(
                    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-goog-api-key': apiKey
                        },
                        body: JSON.stringify({
                            contents: [{
                                parts: [{
                                    text: message.trim()
                                }]
                            }]
                        })
                    }
                );

                const result = await response.json();

                if (!response.ok) {
                    console.error(
                        'GEMINI API ERROR:',
                        response.status,
                        JSON.stringify(result.error || {})
                    );

                    res.writeHead(502, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: 'Gemini request failed. Check Render logs.'
                    }));
                    return;
                }

                const reply = (result.candidates || [])
                    .flatMap(candidate =>
                        candidate.content?.parts || []
                    )
                    .map(part => part.text || '')
                    .join('')
                    .trim();

                if (!reply) {
                    console.error(
                        'GEMINI returned no text:',
                        JSON.stringify(result.promptFeedback || {})
                    );

                    res.writeHead(502, {
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({
                        error: 'Gemini returned no text'
                    }));
                    return;
                }

                res.writeHead(200, {
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({
                    reply: reply
                }));

            } catch (error) {
                console.error('CHAT ERROR:', error.message);

                if (!res.headersSent) {
                    res.writeHead(500, {
                        'Content-Type': 'application/json'
                    });
                }

                if (!res.writableEnded) {
                    res.end(JSON.stringify({
                        error: 'AI request failed. Check Render logs.'
                    }));
                }
            }
        });

        return;
    }

    // Unknown route
    res.writeHead(404, {
        'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({
        error: 'Not found'
    }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS V7 running on port ${PORT}`);
});
