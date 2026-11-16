import { DatabaseSync } from 'node:sqlite';

const sampleProducts = [
  ['VE-001', 'Copo Boreal', 'Long drink', 350, 875, 'highball'],
  ['VE-002', 'Copo Atlas', 'Whisky', 280, 1120, 'rocks'],
  ['VE-003', 'Copo Aurora', 'Canelado', 320, 960, 'ribbed'],
  ['VE-004', 'Copo Cristal', 'Água e suco', 400, 790, 'water'],
  ['VE-005', 'Copo Orla', 'Long drink', 450, 1240, 'highball'],
  ['VE-006', 'Copo Nexo', 'Whisky', 250, 1050, 'rocks']
];

export class Store {
  constructor(filename, seed = true) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        category TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0),
        costCents INTEGER NOT NULL CHECK (costCents > 0), style TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS exchange_rates (
        currency TEXT PRIMARY KEY, rate REAL NOT NULL CHECK (rate > 0),
        date TEXT NOT NULL, fetchedAt INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY, customer TEXT NOT NULL, countryCode TEXT NOT NULL,
        currency TEXT NOT NULL, rate REAL NOT NULL, rateDate TEXT,
        source TEXT NOT NULL, createdAt TEXT NOT NULL, totalMinor INTEGER NOT NULL,
        items TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY) STRICT;
      CREATE TABLE IF NOT EXISTS quote_requests (
        requestKey TEXT PRIMARY KEY, requestHash TEXT NOT NULL, quoteId INTEGER NOT NULL
      ) STRICT;
    `);
    this.transaction(() => {
      const initialized = this.db.prepare("SELECT key FROM settings WHERE key = 'initialized'").get();
      if (initialized) return;
      if (seed) {
        const insert = this.db.prepare('INSERT INTO products (sku, name, category, capacity, costCents, style) VALUES (?, ?, ?, ?, ?, ?)');
        for (const product of sampleProducts) insert.run(...product);
      }
      this.db.prepare("INSERT INTO settings (key) VALUES ('initialized')").run();
    });
  }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  products() {
    return this.db.prepare('SELECT * FROM products ORDER BY sku').all();
  }

  product(id) {
    return this.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  }

  saveProduct(product, id) {
    const fields = [product.sku, product.name, product.category, product.capacity, product.costCents, product.style];
    if (id) {
      this.db.prepare('UPDATE products SET sku = ?, name = ?, category = ?, capacity = ?, costCents = ?, style = ? WHERE id = ?').run(...fields, id);
    } else {
      id = Number(this.db.prepare('INSERT INTO products (sku, name, category, capacity, costCents, style) VALUES (?, ?, ?, ?, ?, ?)').run(...fields).lastInsertRowid);
    }
    return this.product(id);
  }

  setActive(id, active) {
    this.db.prepare('UPDATE products SET active = ? WHERE id = ?').run(Number(active), id);
    return this.product(id);
  }

  rate(currency) {
    return this.db.prepare('SELECT rate, date, fetchedAt FROM exchange_rates WHERE currency = ?').get(currency);
  }

  saveRate(currency, rate, date, fetchedAt) {
    this.db.prepare(`
      INSERT INTO exchange_rates VALUES (?, ?, ?, ?)
      ON CONFLICT (currency) DO UPDATE SET rate = excluded.rate, date = excluded.date, fetchedAt = excluded.fetchedAt
      WHERE excluded.date >= exchange_rates.date AND excluded.fetchedAt >= exchange_rates.fetchedAt
    `).run(currency, rate, date, fetchedAt);
    return this.rate(currency);
  }

  quotes() {
    return this.db.prepare('SELECT id, customer, countryCode, currency, source, createdAt, totalMinor FROM quotes ORDER BY id DESC').all();
  }

  quote(id) {
    const row = this.db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
    return row && { ...row, items: JSON.parse(row.items) };
  }

  quoteRequest(key) {
    return this.db.prepare('SELECT requestHash, quoteId FROM quote_requests WHERE requestKey = ?').get(key);
  }

  saveQuote(quote) {
    const result = this.db.prepare(`
      INSERT INTO quotes (customer, countryCode, currency, rate, rateDate, source, createdAt, totalMinor, items)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(quote.customer, quote.countryCode, quote.currency, quote.rate, quote.rateDate, quote.source,
      quote.createdAt, quote.totalMinor, JSON.stringify(quote.items));
    const id = Number(result.lastInsertRowid);
    if (quote.requestKey) {
      this.db.prepare('INSERT INTO quote_requests VALUES (?, ?, ?)').run(quote.requestKey, quote.requestHash, id);
    }
    return this.quote(id);
  }
}
