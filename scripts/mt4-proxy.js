const http = require('http');

const TARGET_PORT = 3000;
const TARGET_HOST = '127.0.0.1';
const LISTEN_PORT = 80;
const LISTEN_HOST = '127.0.0.1';

const server = http.createServer((req, res) => {
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${TARGET_HOST}:${TARGET_PORT}`
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('[MT4 Proxy Error]', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy forwarding failed', message: err.message }));
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`🚀 MT4 WebRequest Proxy running at http://${LISTEN_HOST}:${LISTEN_PORT} -> forwarding to http://${TARGET_HOST}:${TARGET_PORT}`);
});
