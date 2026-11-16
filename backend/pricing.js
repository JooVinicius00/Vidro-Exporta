import { createHash } from 'node:crypto';

export const markets = [
  { code: 'US', name: 'Estados Unidos', currency: 'USD', label: 'Dólar americano', digits: 2, demo: 0.18 },
  { code: 'PT', name: 'Portugal', currency: 'EUR', label: 'Euro', digits: 2, demo: 0.16 },
  { code: 'DE', name: 'Alemanha', currency: 'EUR', label: 'Euro', digits: 2, demo: 0.16 },
  { code: 'AR', name: 'Argentina', currency: 'ARS', label: 'Peso argentino', digits: 2, demo: 230 },
  { code: 'BR', name: 'Brasil', currency: 'BRL', label: 'Real brasileiro', digits: 2, demo: 1 },
  { code: 'CA', name: 'Canadá', currency: 'CAD', label: 'Dólar canadense', digits: 2, demo: 0.25 },
  { code: 'CL', name: 'Chile', currency: 'CLP', label: 'Peso chileno', digits: 0, demo: 170 },
  { code: 'ES', name: 'Espanha', currency: 'EUR', label: 'Euro', digits: 2, demo: 0.16 },
  { code: 'FR', name: 'França', currency: 'EUR', label: 'Euro', digits: 2, demo: 0.16 },
  { code: 'JP', name: 'Japão', currency: 'JPY', label: 'Iene japonês', digits: 0, demo: 27 },
  { code: 'MX', name: 'México', currency: 'MXN', label: 'Peso mexicano', digits: 2, demo: 3.5 },
  { code: 'GB', name: 'Reino Unido', currency: 'GBP', label: 'Libra esterlina', digits: 2, demo: 0.14 },
  { code: 'CH', name: 'Suíça', currency: 'CHF', label: 'Franco suíço', digits: 2, demo: 0.15 }
];
export const publicMarkets = markets.map(({ demo, ...market }) => market);
export const MARKUP = 100;
const CACHE_MS = 60 * 60 * 1000;

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function marketFor(code) {
  const market = markets.find((entry) => entry.code === code);
  if (!market) throw new AppError(400, 'Selecione um país da lista de destinos.');
  return market;
}

export class ExchangeService {
  constructor(store, fetchRate = fetch, allowDemo = true) {
    this.store = store;
    this.fetchRate = fetchRate;
    this.allowDemo = allowDemo;
    this.pending = new Map();
    this.lastFailure = new Map();
  }

  async get(market, refresh = false) {
    if (market.currency === 'BRL') return { rate: 1, date: null, source: 'base' };
    const cached = this.store.rate(market.currency);
    const now = Date.now();
    if (!refresh && cached && now - cached.fetchedAt < CACHE_MS) {
      return { ...cached, source: 'frankfurter' };
    }
    if (!refresh && now - (this.lastFailure.get(market.currency) ?? 0) < 60_000) return this.fallback(market);
    if (!this.pending.has(market.currency)) {
      const request = this.update(market).finally(() => this.pending.delete(market.currency));
      this.pending.set(market.currency, request);
    }
    return this.pending.get(market.currency);
  }

  async update(market) {
    try {
      const url = new URL('https://api.frankfurter.dev/v2/rates');
      url.search = new URLSearchParams({ base: 'BRL', quotes: market.currency });
      const response = await this.fetchRate(url, { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw new Error('Câmbio indisponível');
      const records = await response.json();
      const record = records.find((entry) => entry.base === 'BRL' && entry.quote === market.currency);
      if (!record || !Number.isFinite(record.rate) || record.rate <= 0 || record.rate > 100000 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
          !Number.isFinite(Date.parse(record.date + 'T12:00:00Z')) ||
          new Date(record.date + 'T12:00:00Z').toISOString().slice(0, 10) !== record.date) {
        throw new Error('Câmbio inválido');
      }
      this.lastFailure.delete(market.currency);
      return { ...this.store.saveRate(market.currency, record.rate, record.date, Date.now()), source: 'frankfurter' };
    } catch {
      this.lastFailure.set(market.currency, Date.now());
      return this.fallback(market);
    }
  }

  fallback(market) {
    const cached = this.store.rate(market.currency);
    if (cached) return { ...cached, source: 'cache' };
    if (this.allowDemo) return { rate: market.demo, date: null, source: 'demo' };
    throw new AppError(503, 'A taxa de câmbio está indisponível. Tente atualizar em instantes.');
  }
}

export class PricingService {
  constructor(store, exchange) {
    this.store = store;
    this.exchange = exchange;
  }

  price(product, market, exchange) {
    const saleCents = product.costCents * 2;
    // Keep the rate in decimal form so half-cent cases round consistently.
    const [mantissa, exponent = '0'] = String(exchange.rate).split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    const scale = fraction.length - Number(exponent) + 2 - market.digits;
    let numerator = BigInt(saleCents) * BigInt(whole + fraction);
    let divisor = 1n;
    if (scale >= 0) divisor = 10n ** BigInt(scale);
    else numerator *= 10n ** BigInt(-scale);
    const unitMinor = Number((2n * numerator + divisor) / (2n * divisor));
    return { ...product, saleCents, unitMinor };
  }

  async prices(code, refresh) {
    const market = marketFor(code);
    const rate = await this.exchange.get(market, refresh);
    return {
      market: publicMarkets.find((entry) => entry.code === code), exchange: rate, markup: MARKUP,
      products: this.store.products().filter((product) => product.active).map((product) => this.price(product, market, rate))
    };
  }

  async quote(body) {
    const market = marketFor(body.countryCode);
    const customer = typeof body.customer === 'string' ? body.customer.trim() : '';
    if (!customer || customer.length > 100) throw new AppError(400, 'Informe um cliente com até 100 caracteres.');
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) {
      throw new AppError(400, 'Inclua de 1 a 50 produtos na cotação.');
    }
    const ids = new Set();
    for (const item of body.items) {
      if (!item || !Number.isSafeInteger(item.id) || item.id < 1 ||
          !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000 || ids.has(item.id) ||
          !Number.isSafeInteger(item.unitMinor) || item.unitMinor < 0) {
        throw new AppError(400, 'Confira os produtos e as quantidades informadas.');
      }
      ids.add(item.id);
    }
    const requestKey = body.requestKey;
    if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestKey))) {
      throw new AppError(400, 'Identificador da solicitação inválido. Reabra a aplicação.');
    }
    const requestHash = createHash('sha256').update(JSON.stringify({
      customer, countryCode: market.code, rate: body.rate, rateDate: body.rateDate, source: body.source,
      items: body.items.map(({ id, quantity, unitMinor }) => ({ id, quantity, unitMinor }))
    })).digest('hex');
    const previous = this.previousQuote(requestKey, requestHash);
    if (previous) return previous;
    const exchange = await this.exchange.get(market);
    return this.store.transaction(() => {
      const concurrent = this.previousQuote(requestKey, requestHash);
      if (concurrent) return concurrent;
      if (body.rate !== exchange.rate || body.rateDate !== exchange.date || body.source !== exchange.source) {
        throw new AppError(409, 'A taxa mudou. Revise os valores atualizados e salve novamente.');
      }
      let totalMinor = 0;
      const items = body.items.map((item) => {
        const product = this.store.product(item.id);
        if (!product?.active) throw new AppError(409, 'Um dos produtos está indisponível. Revise os itens da cotação.');
        const price = this.price(product, market, exchange);
        if (price.unitMinor !== item.unitMinor) throw new AppError(409, 'Um preço mudou. Revise os valores e salve novamente.');
        const subtotalMinor = price.unitMinor * item.quantity;
        totalMinor += subtotalMinor;
        return { ...price, quantity: item.quantity, subtotalMinor };
      });
      if (!Number.isSafeInteger(totalMinor)) throw new AppError(400, 'O valor total excede o limite da cotação.');
      return this.store.saveQuote({ customer, countryCode: market.code, currency: market.currency,
        rate: exchange.rate, rateDate: exchange.date, source: exchange.source, totalMinor, items,
        createdAt: new Date().toISOString(), requestKey, requestHash });
    });
  }

  previousQuote(requestKey, requestHash) {
    if (!requestKey) return null;
    const previous = this.store.quoteRequest(requestKey);
    if (!previous) return null;
    if (previous.requestHash !== requestHash) {
      throw new AppError(409, 'Esta solicitação já foi salva com outros valores. Consulte o histórico de cotações.');
    }
    return this.store.quote(previous.quoteId);
  }
}
