// Tiny static + test-endpoint server for the test suite. No dependencies.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const noStore = { 'cache-control': 'no-store' };
  if (url.pathname === '/bytes') {
    // /bytes?kb=200 -> 200 KiB of incompressible data
    const kb = Number(url.searchParams.get('kb') ?? 100);
    const body = randomBytes(kb * 1024);
    res.writeHead(200, { ...noStore, 'content-type': 'application/octet-stream', 'content-length': body.length });
    return res.end(body);
  }
  if (url.pathname === '/upload' && req.method === 'POST') {
    let n = 0;
    req.on('data', (c) => (n += c.length));
    req.on('end', () => {
      res.writeHead(200, { ...noStore, 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: n }));
    });
    return;
  }
  if (url.pathname === '/heavy.html') {
    // A page that pulls a 100 KiB script, so "page load time" depends on bandwidth.
    const kb = Number(url.searchParams.get('kb') ?? 100);
    res.writeHead(200, { ...noStore, 'content-type': 'text/html' });
    return res.end(`<!doctype html><title>heavy</title><script src="/blob.js?kb=${kb}"></script><p id="done">loaded</p>`);
  }
  if (url.pathname === '/blob.js') {
    const kb = Number(url.searchParams.get('kb') ?? 100);
    const filler = '/*' + 'x'.repeat(kb * 1024 - 40) + '*/';
    res.writeHead(200, { ...noStore, 'content-type': 'text/javascript' });
    return res.end(`window.__blobLoaded = true;${filler}`);
  }
  try {
    const file = path.join(root, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root)) throw new Error('nope');
    const body = await readFile(file);
    res.writeHead(200, { ...noStore, 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`test server on http://127.0.0.1:${port}`));
