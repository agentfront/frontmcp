// A server that keeps listening for a while after SIGTERM, as a gracefully draining server can.
const http = require('node:http');

const port = Number(process.env.PORT);
const lingerMs = Number(process.env.LINGER_MS ?? 1500);

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ok');
});

server.listen(port);

process.on('SIGTERM', () => {
  setTimeout(() => server.close(() => process.exit(0)), lingerMs);
});
