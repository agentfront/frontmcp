import * as http from 'http';
import { checkHealth } from '../pm.health';

describe('pm.health', () => {
  let server: http.Server;
  let serverPort: number;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      serverPort = (server.address() as { port: number }).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('should return healthy for a running server', async () => {
    const result = await checkHealth({ port: serverPort, timeout: 2000 });
    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('should return unhealthy for a non-existent port', async () => {
    const result = await checkHealth({ port: 59999, timeout: 1000 });
    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return unhealthy when no port or socket provided', async () => {
    const result = await checkHealth({});
    expect(result.healthy).toBe(false);
    expect(result.error).toBe('No port or socket path provided');
  });
});
