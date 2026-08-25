// Oddiy backend — Node'ning oʻz http moduli, tashqi kutubxonasiz.
// Telefonda ishlamaydi; serverda yoki GitHub Codespaces'da ishga tushiriladi.
import { createServer } from 'node:http';

const PORT = process.env.PORT || 3000;
const items = [];

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();

  if (req.url === '/api/items' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(items));
  }

  if (req.url === '/api/items' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const item = JSON.parse(body);
      items.push({ id: items.length + 1, ...item });
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(items.at(-1)));
    } catch {
      res.statusCode = 400;
      return res.end('{"error":"notoʻgʻri JSON"}');
    }
  }

  res.statusCode = 404;
  res.end('{"error":"topilmadi"}');
});

server.listen(PORT, () => console.log('API ishlayapti:', PORT));
