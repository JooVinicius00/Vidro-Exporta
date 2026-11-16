import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './backend/store.js';
import { ExchangeService, PricingService, marketFor } from './backend/pricing.js';
import { makeServer } from './backend/server.js';

const liveRate = async () => ({
  ok: true,
  json: async () => [{ base: 'BRL', quote: 'USD', rate: 0.18, date: '2026-11-09' }]
});
const unavailable = async () => { throw new Error('offline'); };

test('markup de 100% e arredondamento monetário consistente', () => {
  const pricing = new PricingService();
  const result = pricing.price({ costCents: 875 }, marketFor('US'), { rate: 0.18 });
  assert.equal(result.saleCents, 1750);
  assert.equal(result.unitMinor, 315);
  assert.equal(pricing.price({ costCents: 251 }, marketFor('US'), { rate: 0.25 }).unitMinor, 126);
  assert.equal(pricing.price({ costCents: 875 }, marketFor('JP'), { rate: 27 }).unitMinor, 473);
  assert.equal(pricing.price({ costCents: 1 }, marketFor('US'), { rate: 1e-7 }).unitMinor, 0);
});

test('taxa externa é validada, persistida e compartilhada entre requisições concorrentes', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const service = new ExchangeService(store, async () => { calls++; return liveRate(); });
  const [first, second] = await Promise.all([service.get(marketFor('US')), service.get(marketFor('US'))]);
  assert.equal(calls, 1);
  assert.equal(first.rate, second.rate);
  assert.equal(first.source, 'frankfurter');
  await service.get(marketFor('US'));
  assert.equal(calls, 1);
  assert.equal(store.rate('USD').date, '2026-11-09');
  store.db.close();
});

test('indisponibilidade usa cache ou demonstração e suporta desativar taxas ilustrativas', async () => {
  const store = new Store(':memory:');
  const service = new ExchangeService(store, unavailable);
  assert.equal((await service.get(marketFor('US'))).source, 'demo');
  store.saveRate('USD', 0.2, '2026-10-01', 1);
  const cached = await service.get(marketFor('US'), true);
  assert.equal(cached.source, 'cache');
  assert.equal(cached.rate, 0.2);
  await assert.rejects(() => new ExchangeService(store, unavailable, false).get(marketFor('GB')), { status: 503 });
  store.db.close();
});

test('taxa inválida do fornecedor é rejeitada e BRL usa identidade', async () => {
  const store = new Store(':memory:');
  const service = new ExchangeService(store, async () => ({ ok: true, json: async () => [{ base: 'BRL', quote: 'USD', rate: -1, date: 'invalid' }] }));
  assert.equal((await service.get(marketFor('US'))).source, 'demo');
  assert.equal(store.rate('USD'), undefined);
  assert.deepEqual(await service.get(marketFor('BR')), { rate: 1, date: null, source: 'base' });
  store.db.close();
});

test('API HTTP, cadastro, cotação, consistência e validações', async (t) => {
  const store = new Store(':memory:');
  const server = makeServer({ store, fetchRate: liveRate });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.db.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + path, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    return { status: response.status, data };
  };

  await t.test('HTML, JS, CSS e imagem são entregues', async () => {
    for (const path of ['/', '/app.js', '/styles.css', '/glass.png']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.ok(Number(response.headers.get('content-length')) > 100);
      await response.arrayBuffer();
    }
  });

  const product = { sku: 'TEST-001', name: 'Copo de teste', category: 'Whisky', capacity: 250, costCents: 251, style: 'rocks' };
  let saved;
  await t.test('cria e edita produtos com SKU único', async () => {
    const created = await request('/api/products', 'POST', product);
    assert.equal(created.status, 201);
    saved = created.data;
    assert.equal((await request('/api/products', 'POST', product)).status, 409);
    assert.equal((await request('/api/products/' + saved.id, 'PUT', { ...product, name: 'Copo revisado' })).status, 200);
  });

  await t.test('valida custos, tipos, destinos e origem', async () => {
    assert.equal((await request('/api/products', 'POST', { ...product, costCents: 1.5 })).status, 400);
    assert.equal((await request('/api/products', 'POST', { ...product, costCents: -1 })).status, 400);
    assert.equal((await request('/api/products', 'POST', { ...product, style: '<script>' })).status, 400);
    assert.equal((await request('/api/prices?country=XX')).status, 400);
    assert.equal((await request('/api/products', 'POST', product, { Origin: 'https://example.com' })).status, 403);
    const malformed = await fetch(base + '/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    const large = await fetch(base + '/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'a'.repeat(30000) }) });
    assert.equal(large.status, 413);
  });

  const prices = (await request('/api/prices?country=US')).data;
  const priced = prices.products.find((entry) => entry.id === saved.id);
  const quoteBody = {
    customer: 'Cliente & Filhos', countryCode: 'US',
    rate: prices.exchange.rate, rateDate: prices.exchange.date, source: prices.exchange.source,
    items: [{ id: saved.id, quantity: 20, unitMinor: priced.unitMinor }]
  };
  let quote;
  await t.test('salva cotação sem aceitar preços arbitrários do navegador', async () => {
    assert.equal((await request('/api/quotes', 'POST', { ...quoteBody, items: [{ ...quoteBody.items[0], unitMinor: 1 }] })).status, 409);
    const result = await request('/api/quotes', 'POST', quoteBody);
    assert.equal(result.status, 201);
    quote = result.data;
    assert.equal(quote.totalMinor, priced.unitMinor * 20);
    assert.equal(quote.items[0].name, 'Copo revisado');
    assert.equal(quote.items[0].costCents, 251);
    assert.equal((await request('/api/quotes')).data.length, 1);
  });

  await t.test('preserva histórico e detecta alteração de custo antes de salvar', async () => {
    await request('/api/products/' + saved.id, 'PUT', { ...product, costCents: 1000 });
    assert.equal((await request('/api/quotes', 'POST', quoteBody)).status, 409);
    const historic = (await request('/api/quotes/' + quote.id)).data;
    assert.equal(historic.totalMinor, quote.totalMinor);
    assert.equal(historic.items[0].costCents, 251);
  });

  await t.test('quantidades inválidas e duplicatas são rejeitadas sem gravação parcial', async () => {
    for (const quantity of [0, -1, 1.5, 100001, '2']) {
      assert.equal((await request('/api/quotes', 'POST', { ...quoteBody, items: [{ ...quoteBody.items[0], quantity }] })).status, 400);
    }
    assert.equal((await request('/api/quotes', 'POST', { ...quoteBody, items: [null] })).status, 400);
    assert.equal((await request('/api/quotes', 'POST', { ...quoteBody, items: [quoteBody.items[0], quoteBody.items[0]] })).status, 400);
    assert.equal((await request('/api/quotes')).data.length, 1);
  });

  await t.test('arquiva e reativa produtos e rejeita cotação com item arquivado', async () => {
    await request('/api/products/' + saved.id, 'PATCH', { active: false });
    const updated = (await request('/api/prices?country=US')).data;
    assert.ok(!updated.products.some((entry) => entry.id === saved.id));
    assert.equal((await request('/api/quotes', 'POST', quoteBody)).status, 409);
    assert.equal((await request('/api/products/' + saved.id, 'PATCH', { active: true })).status, 200);
  });

  await t.test('detecta mudança de câmbio e impede taxa falsificada', async () => {
    const current = (await request('/api/prices?country=US')).data;
    const line = current.products.find((entry) => entry.id === saved.id);
    const body = { ...quoteBody, items: [{ id: saved.id, quantity: 1, unitMinor: line.unitMinor }] };
    store.saveRate('USD', 0.19, '2026-11-10', Date.now() + 1);
    assert.equal((await request('/api/quotes', 'POST', body)).status, 409);
    assert.equal((await request('/api/quotes')).data.length, 1);
  });

  await t.test('endereços inexistentes retornam JSON de erro', async () => {
    assert.equal((await request('/api/quotes/999999')).status, 404);
    assert.equal((await request('/api/products/999999', 'PUT', product)).status, 404);
    assert.equal((await request('/api/unknown')).status, 404);
  });

  await t.test('repetição concorrente da mesma solicitação cria uma única cotação', async () => {
    const latest = (await request('/api/prices?country=US')).data;
    const price = latest.products.find((entry) => entry.id === saved.id);
    const body = {
      ...quoteBody, requestKey: '1bdf5682-c01d-49e2-8cc5-64f4af659a48',
      rate: latest.exchange.rate, rateDate: latest.exchange.date, source: latest.exchange.source,
      items: [{ id: saved.id, quantity: 3, unitMinor: price.unitMinor }]
    };
    const results = await Promise.all([request('/api/quotes', 'POST', body), request('/api/quotes', 'POST', body)]);
    assert.equal(results[0].status, 201);
    assert.equal(results[1].status, 201);
    assert.equal(results[0].data.id, results[1].data.id);
    assert.equal((await request('/api/quotes')).data.length, 2);
    assert.equal((await request('/api/quotes', 'POST', { ...body, customer: 'Outra empresa' })).status, 409);
  });
});
