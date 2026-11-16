import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { AppError, ExchangeService, PricingService, publicMarkets } from './pricing.js';

const frontend = new URL('../frontend/', import.meta.url);
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/inter.woff2': ['inter.woff2', 'font/woff2'],
  '/glass.webp': ['glass.webp', 'image/webp'],
  '/glass.png': ['glass.png', 'image/png']
};
const styles = new Set(['highball', 'rocks', 'ribbed', 'water']);

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AppError(415, 'Envie os dados em JSON.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 24_576) {
      req.resume();
      throw new AppError(413, 'O conteúdo enviado é muito grande.');
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new AppError(400, 'Os dados enviados são inválidos.');
  }
}

function productData(body) {
  const sku = typeof body.sku === 'string' ? body.sku.trim().toUpperCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const { capacity, costCents, style } = body;
  if (!/^[A-Z0-9][A-Z0-9._-]{0,23}$/.test(sku)) throw new AppError(400, 'Use até 24 letras, números, pontos, hífens ou sublinhados no SKU.');
  if (!name || name.length > 80 || !category || category.length > 40) {
    throw new AppError(400, 'Informe nome (até 80 caracteres) e categoria (até 40).');
  }
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10000 ||
      !Number.isSafeInteger(costCents) || costCents < 1 || costCents > 10000000 || !styles.has(style)) {
    throw new AppError(400, 'Confira a capacidade, o custo e o tipo de copo.');
  }
  return { sku, name, category, capacity, costCents, style };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function makeServer({ store, fetchRate, allowDemo = true }) {
  const pricing = new PricingService(store, new ExchangeService(store, fetchRate, allowDemo));
  return createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const authority = req.headers.host;
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(authority ?? '')) {
        throw new AppError(403, 'Este servidor aceita somente acesso local.');
      }
      const url = new URL(req.url, 'http://' + authority);
      const path = url.pathname;
      const method = req.method;
      if (path.startsWith('/api/') && (req.headers['sec-fetch-site'] === 'cross-site' ||
          (req.headers.origin && req.headers.origin !== url.origin))) {
        throw new AppError(403, 'Origem da requisição inválida.');
      }
      if (method === 'GET' && path === '/api/markets') return sendJson(res, 200, publicMarkets);
      if (method === 'GET' && path === '/api/prices') {
        return sendJson(res, 200, await pricing.prices(url.searchParams.get('country'), url.searchParams.get('refresh') === '1'));
      }
      if (method === 'GET' && path === '/api/products') return sendJson(res, 200, store.products());
      if (method === 'POST' && path === '/api/products') {
        return sendJson(res, 201, store.saveProduct(productData(await readJson(req))));
      }
      const productPath = /^\/api\/products\/([1-9]\d{0,14})$/.exec(path);
      if (productPath && ['PUT', 'PATCH'].includes(method)) {
        const id = Number(productPath[1]);
        const body = await readJson(req);
        if (!store.product(id)) throw new AppError(404, 'Produto não encontrado.');
        if (method === 'PUT') return sendJson(res, 200, store.saveProduct(productData(body), id));
        if (typeof body.active !== 'boolean') throw new AppError(400, 'Informe o status do produto.');
        return sendJson(res, 200, store.setActive(id, body.active));
      }
      if (method === 'GET' && path === '/api/quotes') return sendJson(res, 200, store.quotes());
      if (method === 'POST' && path === '/api/quotes') return sendJson(res, 201, await pricing.quote(await readJson(req)));
      const quotePath = /^\/api\/quotes\/([1-9]\d{0,14})$/.exec(path);
      if (method === 'GET' && quotePath) {
        const quote = store.quote(Number(quotePath[1]));
        if (!quote) throw new AppError(404, 'Cotação não encontrada.');
        return sendJson(res, 200, quote);
      }
      const asset = Object.hasOwn(assets, path) && assets[path];
      if (asset && ['GET', 'HEAD'].includes(method)) {
        const [filename, type] = asset;
        try {
          const data = await readFile(new URL(filename, frontend));
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
          return res.end(method === 'HEAD' ? undefined : data);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      throw new AppError(404, 'Endereço não encontrado.');
    } catch (error) {
      if (error instanceof AppError) return sendJson(res, error.status, { error: error.message });
      if (error.errcode === 2067) return sendJson(res, 409, { error: 'Este SKU já existe no catálogo.' });
      console.error(error);
      return sendJson(res, 500, { error: 'Erro interno. Tente novamente.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.env.DATABASE_FILE || fileURLToPath(new URL('../data/vidro-exporta.sqlite', import.meta.url));
  mkdirSync(dirname(filename), { recursive: true });
  const store = new Store(filename, process.env.SEED_DEMO !== '0');
  const server = makeServer({ store, allowDemo: process.env.ALLOW_DEMO_RATES !== '0' });
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
    console.log('Vidro Exporta disponível em http://127.0.0.1:' + server.address().port);
  });
}
