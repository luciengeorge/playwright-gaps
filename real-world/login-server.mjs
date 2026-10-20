import { createServer } from 'node:http';
createServer((req, res) => {
  const cookies = Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => c.split('=')));
  const html = (b) => { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(`<!doctype html><title>t</title>${b}`); };
  if (req.url === '/login' && req.method === 'POST') {
    res.writeHead(303, { location: '/account', 'set-cookie': 'sid=s3cr3t-session; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax' });
    return res.end();
  }
  if (req.url === '/account') return html(cookies.sid === 's3cr3t-session' ? '<h1 id="who">Welcome back, lucien</h1>' : '<h1 id="who">Please log in</h1><form method="post" action="/login"><button id="login">Log in</button></form>');
  if (req.url === '/ads') return html('<h1>ads test</h1><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script><script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>');
  html('<p>ok</p>');
}).listen(5600, '127.0.0.1');
