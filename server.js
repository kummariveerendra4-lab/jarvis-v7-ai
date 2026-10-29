
const http = require('http');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const PORT = process.env.PORT || 3000;

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const server = http.createServer((req, res) => {
    console.log('REQUEST:', req.method, req.url);

    // JARVIS homepage
    if (req.method === 'GET' && req.url === '/') {
        const filePath = path.join(__dirname, 'Index.html');

        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                console.error('HTML READ ERROR:', err.message);

                if (!res.headersSent) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                }

                res.end('Could not load Index.html. Check its filename.');
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
            aiConfigured: Boolean(process.env.OPENAI_API_KEY)
        }));

        return;
    }

    // AI chat
    if (req.method === 'POST' && req.url === '/chat') {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 100000) {
                req.destroy();
            }
        });

        req.on('end', async () => {
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

                if (!process.env.OPENAI_API_KEY) {
                    res.writeHead(503, {
                        'Content-Type': 'application/json'
                    });

                    res.end(JSON.stringify({
                        error: 'AI API key is not configured'
                    }));

                    return;
                }

                const response = await client.responses.create({
                    model: 'gpt-5.5',
                    input: message
                });

                res.writeHead(200, {
                    'Content-Type': 'application/json'
                });

                res.end(JSON.stringify({
                    reply: response.output_text
                }));

            } catch (error) {
                console.error('CHAT ERROR:', error.message);

                if (!res.headersSent) {
                    res.writeHead(500, {
                        'Content-Type': 'application/json'
                    });
                }

                res.end(JSON.stringify({
                    error: 'AI request failed. Check Render logs and API quota.'
                }));
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
