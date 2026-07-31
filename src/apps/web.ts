import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { renderHumanAuthorityBrief } from '../web/index.js';

const port = Number.parseInt(process.env['WEB_PORT'] ?? '3001', 10);
const server = createServer((request, response) => {
  const nonce = randomBytes(18).toString('base64');
  const securityHeaders = {
    'content-security-policy': `default-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cache-control': 'no-store',
  };
  if (request.url === '/health/live' || request.url === '/health/ready') {
    response.writeHead(200, { ...securityHeaders, 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ready' }));
    return;
  }
  if (request.method === 'GET' && request.url === '/assets/app.css') {
    response.writeHead(200, { ...securityHeaders, 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    response.end('body{font:1rem/1.5 system-ui;max-width:75rem;margin:auto;padding:1rem}a,button{min-height:2.75rem}.skip{position:absolute;left:-9999px}.skip:focus{position:static}section{margin-block:2rem}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important}}');
    return;
  }
  if (request.method === 'GET' && request.url === '/') {
    const csrf = nonce;
    response.writeHead(200, { ...securityHeaders, 'content-type': 'text/html; charset=utf-8' });
    response.end(renderHumanAuthorityBrief({
      title: 'No decision brief selected',
      claims: [],
      dissent: [],
      assumptions: [],
      limitations: ['Authenticate through the trusted edge and select a versioned decision brief.'],
      abstention: { reason: 'No brief is available.', unblockConditions: ['Select an authorized deliberation.'] },
    }, csrf));
    return;
  }
  response.writeHead(404, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(port, '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => server.close(() => { process.exitCode = 0; }));
}
