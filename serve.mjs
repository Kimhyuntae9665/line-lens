import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createAdvisorService } from './advisor-service.js';
import { AdvisorError } from './advisor-engine.js';
const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const advisor = createAdvisorService();
const apiRoutes = new Set(['/api/advisor/status', '/api/advisor/interpret', '/api/advisor/recommend']);
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new AdvisorError('BODY_TOO_LARGE', '요청 본문은 16KB 이하여야 합니다.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AdvisorError('INVALID_JSON', '유효한 JSON 본문을 입력해 주세요.'); }
}
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowedHosts.has(req.headers.host)) { json(res, 403, { error: { code: 'HOST_FORBIDDEN', message: '로컬 호스트만 사용할 수 있습니다.' } }); return; }
    if (pathname.startsWith('/api/')) {
      if (req.headers.origin && ![...allowedHosts].some(host => req.headers.origin === `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') throw new AdvisorError('ORIGIN_FORBIDDEN', '로컬 페이지에서만 API를 사용할 수 있습니다.', 403);
      if (!apiRoutes.has(pathname)) throw new AdvisorError('NOT_FOUND', '지원하지 않는 API 경로입니다.', 404);
      const expectedMethod = pathname.endsWith('/status') ? 'GET' : 'POST';
      if (req.method !== expectedMethod) throw new AdvisorError('METHOD_NOT_ALLOWED', '지원하지 않는 HTTP 메서드입니다.', 405);
      if (expectedMethod === 'GET') { json(res, 200, await advisor.status()); return; }
      if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new AdvisorError('CONTENT_TYPE_REQUIRED', 'Content-Type: application/json이 필요합니다.', 415);
      const input = await body(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdvisorError('INVALID_INPUT', '요청 본문은 JSON 객체여야 합니다.');
      const started = performance.now();
      try { json(res, 200, await (pathname.endsWith('/interpret') ? advisor.interpret(input) : advisor.recommend(input))); }
      catch (error) {
        if (error.code?.startsWith('LLM_')) {
          const phase = pathname.endsWith('/interpret') ? 'llmInterpretMs' : 'llmExplainMs';
          error[phase] ??= error.llmElapsedMs ?? performance.now() - started;
          error.llmStatus = 'error';
        }
        throw error;
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Method not allowed'); return; }
    if (pathname.replaceAll('\\', '/').split('/').some(part => part.startsWith('.'))) { res.writeHead(403); res.end('Forbidden'); return; }
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!Object.hasOwn(types, extname(path))) { res.writeHead(403); res.end('Forbidden'); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (error instanceof AdvisorError) json(res, error.status, { error: { code: error.code, message: error.message }, llmStatus: error.llmStatus || null, llmModel: error.llmModel || null, llmInterpretMs: error.llmInterpretMs ?? null, llmExplainMs: error.llmExplainMs ?? null });
    else { res.writeHead(404); res.end('Not found'); }
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.timeout = 180000;
server.listen(port, '127.0.0.1', () => console.log(`Line Lens: http://127.0.0.1:${port}`));
