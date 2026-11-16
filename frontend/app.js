const paths = {
  brand: '<path d="M5 4h14l-2 17H7L5 4Z"/><path d="M3 4h18M8 8l1 9m7-9-1 9M9 21l-1 3h8l-1-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  exchange: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  chart: '<path d="M4 4v16h16M7 14l4-4 4 2 5-7M16 5h4v4"/>',
  building: '<path d="M5 21V5l7-2v18M12 8h7v13M3 21h18M8 7v1m0 4v1m0 4v1m7-6v1m0 4v1"/>',
  coins: '<ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v5c0 4 12 4 12 0V6M3 11v5c0 3 9 4 12 1M18 9c5 0 5 6 0 6m0 0c5 0 5 6 0 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  print: '<path d="M7 8V3h10v5M7 16H4V8h16v8h-3M7 13h10v8H7v-8Z"/>'
};
const icon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.file) + '</svg>';
document.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const money = (minor, currency = 'BRL') => {
  const format = new Intl.NumberFormat('pt-BR', { style: 'currency', currency });
  return format.format(minor / 10 ** format.resolvedOptions().maximumFractionDigits);
};
const date = (iso) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(iso));
const rateDate = (iso) => iso ? date(iso + 'T12:00:00Z') : 'Sem data de referência';
const thumbnail = (product) => '<span class="glass-thumb" aria-hidden="true"><span class="glass-art ' + escape(product.style) + '"></span></span>';
const productCell = (product) => '<div class="product-cell">' + thumbnail(product) + '<div><strong>' + escape(product.name) + '</strong><small>' + escape(product.sku) + ' · ' + escape(product.category) + '</small></div></div>';
const matches = (product, search) => (product.name + ' ' + product.sku + ' ' + product.category).toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'));
const sourceMessage = (exchange) => {
  if (exchange.source === 'demo') return 'Taxa de demonstração. O serviço de câmbio está indisponível e este valor é ilustrativo. As cotações salvas serão identificadas como demonstração.';
  if (exchange.source === 'cache') return 'Serviço de câmbio indisponível. Utilizando a última taxa salva, com referência em ' + rateDate(exchange.date) + '.';
  if (exchange.source === 'base') return '';
  return 'Taxa de referência Frankfurter de ' + rateDate(exchange.date) + '.';
};

class Api {
  async request(path, method = 'GET', body) {
    const response = await fetch('/api/' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Não foi possível concluir a operação.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
}

class BackOffice {
  constructor() {
    this.api = new Api();
    this.markets = [];
    this.products = [];
    this.prices = null;
    this.cart = new Map();
    this.view = 'pricing';
    this.requestId = 0;
    this.editId = null;
    this.busy = false;
    this.quoteKey = crypto.randomUUID();
    this.bindEvents();
  }

  async start() {
    try {
      [this.markets, this.products] = await Promise.all([this.api.request('markets'), this.api.request('products')]);
      $('#market').innerHTML = this.markets.map((market) => '<option value="' + market.code + '">' + escape(market.name) + '</option>').join('');
      $('#market').value = 'US';
      $('#market').disabled = false;
      await this.loadPrices();
      this.renderCatalog();
    } catch (error) {
      this.showPricingError(error);
    }
  }

  bindEvents() {
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => this.changeView(button.dataset.view)));
    document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $('#' + button.dataset.close).close()));
    $('#market').addEventListener('change', () => this.loadPrices());
    $('#refresh').addEventListener('click', () => this.loadPrices(true));
    $('#price-search').addEventListener('input', () => this.renderPrices());
    $('#catalog-search').addEventListener('input', () => this.renderCatalog());
    $('#top-action').addEventListener('click', () => this.view === 'catalog' ? this.openProduct() : this.openCart());
    $('#open-cart').addEventListener('click', () => this.openCart());
    $('#price-rows').addEventListener('click', (event) => {
      const button = event.target.closest('[data-add]');
      if (!button) return;
      this.addToCart(Number(button.dataset.add));
    });
    $('#catalog-rows').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit]');
      const toggle = event.target.closest('[data-toggle]');
      if (edit) this.openProduct(Number(edit.dataset.edit));
      if (toggle) this.toggleProduct(Number(toggle.dataset.toggle), toggle);
    });
    $('#quote-rows').addEventListener('click', (event) => {
      const button = event.target.closest('[data-detail]');
      if (button) this.openDetail(Number(button.dataset.detail));
    });
    $('#product-form').addEventListener('submit', (event) => this.saveProduct(event));
    $('#cart-form').addEventListener('submit', (event) => this.saveQuote(event));
    $('#cart-product').addEventListener('change', (event) => {
      if (!event.target.value) return;
      this.addToCart(Number(event.target.value));
      this.renderCart();
    });
    $('#cart-items').addEventListener('input', (event) => {
      if (!event.target.matches('[data-quantity]')) return;
      const quantity = Number(event.target.value);
      if (Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 100000) {
        this.cart.set(Number(event.target.dataset.quantity), quantity);
        this.renderCartTotal();
      }
    });
    $('#cart-items').addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove]');
      if (!button) return;
      this.cart.delete(Number(button.dataset.remove));
      this.renderCart();
      this.renderPrices();
    });
    $('#print-quote').addEventListener('click', () => window.print());
    for (const dialog of document.querySelectorAll('dialog')) {
      dialog.addEventListener('cancel', (event) => { if (this.busy) event.preventDefault(); });
    }
    setInterval(() => {
      if (!document.hidden && this.view === 'pricing' && !$('dialog[open]') && this.markets.length) this.loadPrices();
    }, 15 * 60 * 1000);
  }

  async changeView(view) {
    this.view = view;
    const titles = {
      pricing: ['Precificação', 'Precificação internacional', 'Consulte preços de venda na moeda do mercado de destino.'],
      catalog: ['Catálogo', 'Catálogo de produtos', 'Gerencie os copos de vidro e seus custos de produção.'],
      quotes: ['Cotações', 'Cotações de exportação', 'Acompanhe as propostas criadas para seus clientes.']
    };
    const [breadcrumb, title, description] = titles[view];
    $('#breadcrumb').textContent = breadcrumb;
    $('#page-title').textContent = title;
    $('#page-description').textContent = description;
    for (const section of ['pricing', 'catalog', 'quotes']) $('#view-' + section).hidden = section !== view;
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $('#top-action-label').textContent = view === 'catalog' ? 'Novo produto' : 'Nova cotação';
    $('#top-action').disabled = view !== 'catalog' && !this.prices;
    if (view === 'quotes') await this.loadQuotes();
    if (view === 'catalog') this.renderCatalog();
  }

  async loadPrices(refresh = false) {
    const requestId = ++this.requestId;
    const code = $('#market').value;
    if (!this.markets.some((market) => market.code === code)) return;
    const market = this.markets.find((entry) => entry.code === code);
    this.prices = null;
    $('#flag').className = 'flag ' + code;
    $('#currency-description').textContent = market.label + ' (' + market.currency + ') · Conversão automática';
    $('#refresh').disabled = true;
    if (this.view !== 'catalog') $('#top-action').disabled = true;
    $('#open-cart').disabled = true;
    $('#metric-rate').textContent = 'Atualizando…';
    $('#metric-source').textContent = 'Consultando taxa de referência';
    $('#pricing-notice').hidden = true;
    $('#price-rows').innerHTML = '<tr><td colspan="6" class="empty">Atualizando preços…</td></tr>';
    try {
      const prices = await this.api.request('prices?country=' + code + (refresh ? '&refresh=1' : ''));
      if (requestId !== this.requestId) return;
      this.prices = prices;
      const rate = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 5 }).format(prices.exchange.rate);
      $('#metric-rate').textContent = 'R$ 1 = ' + market.currency + ' ' + rate;
      $('#metric-source').textContent = prices.exchange.source === 'demo' ? 'Demonstração · taxa ilustrativa' :
        prices.exchange.source === 'base' ? 'Real · moeda-base' : 'Referência em ' + rateDate(prices.exchange.date);
      $('#metric-products').textContent = prices.products.length;
      $('#local-column').textContent = 'Preço local (' + market.currency + ')';
      const notice = sourceMessage(prices.exchange);
      $('#pricing-notice').textContent = notice;
      $('#pricing-notice').hidden = !['demo', 'cache'].includes(prices.exchange.source);
      for (const id of this.cart.keys()) {
        if (!prices.products.some((product) => product.id === id)) this.cart.delete(id);
      }
      this.renderPrices();
      $('#open-cart').disabled = false;
      $('#top-action').disabled = false;
    } catch (error) {
      if (requestId === this.requestId) this.showPricingError(error);
    } finally {
      if (requestId === this.requestId) $('#refresh').disabled = false;
    }
  }

  showPricingError(error) {
    this.prices = null;
    $('#metric-rate').textContent = 'Indisponível';
    $('#metric-source').textContent = 'Use o botão de atualizar para tentar novamente';
    $('#pricing-notice').textContent = this.errorMessage(error);
    $('#pricing-notice').hidden = false;
    $('#price-rows').innerHTML = '<tr><td colspan="6" class="empty">Não foi possível carregar os preços.</td></tr>';
    $('#price-count').textContent = 'Preços indisponíveis';
    $('#open-cart').disabled = true;
    if (this.view !== 'catalog') $('#top-action').disabled = true;
  }

  renderPrices() {
    if (!this.prices) return;
    const products = this.prices.products.filter((product) => matches(product, $('#price-search').value));
    $('#price-rows').innerHTML = products.map((product) => {
      const added = this.cart.has(product.id);
      return '<tr><td>' + productCell(product) + '</td><td>' + product.capacity + ' ml</td><td class="numeric">' + money(product.costCents) +
        '</td><td class="numeric">' + money(product.saleCents) + '</td><td class="numeric price-local">' + money(product.unitMinor, this.prices.market.currency) +
        '</td><td class="action-cell"><button class="add-button' + (added ? ' added' : '') + '" data-add="' + product.id +
        '" aria-label="Adicionar ' + escape(product.name) + ' à cotação" title="Adicionar à cotação">' + icon(added ? 'check' : 'plus') + '</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="empty">Nenhum produto encontrado.</td></tr>';
    $('#price-count').textContent = products.length + ' de ' + this.prices.products.length + ' produtos';
    $('#cart-label').textContent = this.cart.size ? 'Abrir cotação (' + this.cart.size + ')' : 'Abrir cotação';
  }

  renderCatalog() {
    const products = this.products.filter((product) => matches(product, $('#catalog-search').value));
    $('#catalog-rows').innerHTML = products.map((product) =>
      '<tr><td>' + productCell(product) + '</td><td>' + product.capacity + ' ml</td><td class="numeric">' + money(product.costCents) +
      '</td><td><span class="badge' + (product.active ? '' : ' inactive') + '">' + (product.active ? 'Ativo' : 'Arquivado') +
      '</span></td><td><button class="text-button" data-edit="' + product.id + '">Editar<span class="visually-hidden"> ' + escape(product.name) +
      '</span></button><button class="text-button" data-toggle="' + product.id + '">' + (product.active ? 'Arquivar' : 'Ativar') +
      '<span class="visually-hidden"> ' + escape(product.name) + '</span></button></td></tr>'
    ).join('') || '<tr><td colspan="5" class="empty">Nenhum produto encontrado. Cadastre seu primeiro produto.</td></tr>';
    $('#catalog-count').textContent = products.length + ' de ' + this.products.length + ' produtos';
  }

  openProduct(id) {
    this.editId = id || null;
    const form = $('#product-form');
    form.reset();
    $('#product-error').hidden = true;
    $('#product-title').textContent = id ? 'Editar produto' : 'Novo produto';
    if (id) {
      const product = this.products.find((entry) => entry.id === id);
      for (const field of ['name', 'sku', 'category', 'capacity', 'style']) form.elements[field].value = product[field];
      form.elements.cost.value = (product.costCents / 100).toFixed(2).replace('.', ',');
    }
    $('#product-dialog').showModal();
  }

  async saveProduct(event) {
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form));
    const normalized = values.cost.trim().replace(',', '.');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(normalized)) {
      this.formError('product-error', 'Informe o custo com até duas casas decimais, por exemplo 8,75.');
      return;
    }
    const [whole, cents = ''] = normalized.split('.');
    const body = { name: values.name, sku: values.sku, category: values.category, capacity: Number(values.capacity),
      costCents: Number(whole) * 100 + Number(cents.padEnd(2, '0')), style: values.style };
    const editing = Boolean(this.editId);
    this.setFormBusy(form, true);
    $('#product-error').hidden = true;
    let saved;
    try {
      saved = await this.api.request('products' + (editing ? '/' + this.editId : ''), editing ? 'PUT' : 'POST', body);
    } catch (error) {
      this.formError('product-error', this.errorMessage(error));
      return;
    } finally {
      this.setFormBusy(form, false);
    }
    const index = this.products.findIndex((product) => product.id === saved.id);
    if (index === -1) this.products.push(saved);
    else this.products[index] = saved;
    this.products.sort((left, right) => left.sku.localeCompare(right.sku));
    $('#product-dialog').close();
    this.renderCatalog();
    this.toast(editing ? 'Produto atualizado.' : 'Produto cadastrado.');
    await this.loadPrices();
  }

  async toggleProduct(id, button) {
    button.disabled = true;
    try {
      const product = this.products.find((entry) => entry.id === id);
      const updated = await this.api.request('products/' + id, 'PATCH', { active: !product.active });
      this.products = this.products.map((entry) => entry.id === id ? updated : entry);
      this.renderCatalog();
      this.toast(updated.active ? 'Produto ativado.' : 'Produto arquivado.');
      await this.loadPrices();
    } catch (error) {
      button.disabled = false;
      this.toast(this.errorMessage(error), true);
    }
  }

  addToCart(id) {
    if (!this.prices?.products.some((product) => product.id === id)) return;
    this.cart.set(id, Math.min(100000, (this.cart.get(id) || 0) + 1));
    this.renderPrices();
    this.toast('Produto adicionado à cotação.');
  }

  openCart() {
    if (!this.prices) return;
    $('#cart-error').hidden = true;
    this.renderCart();
    $('#cart-dialog').showModal();
  }

  renderCart() {
    const { market, exchange, products } = this.prices;
    $('#cart-market').textContent = market.name + ' · ' + market.currency + ' · Lucro sobre o custo de 100%';
    $('#cart-product').innerHTML = '<option value="">Selecione um produto</option>' + products.map((product) =>
      '<option value="' + product.id + '">' + escape(product.name) + ' · ' + money(product.unitMinor, market.currency) + '</option>'
    ).join('');
    $('#cart-items').innerHTML = [...this.cart.entries()].map(([id, quantity]) => {
      const product = products.find((entry) => entry.id === id);
      return '<div class="cart-item">' + thumbnail(product) + '<div class="cart-item-info"><strong>' + escape(product.name) +
        '</strong><small>' + escape(product.sku) + ' · ' + product.capacity + ' ml</small></div><input type="number" required min="1" max="100000" step="1" value="' + quantity +
        '" data-quantity="' + id + '" aria-label="Quantidade de ' + escape(product.name) + '"><span class="cart-item-price">' +
        money(product.unitMinor, market.currency) + ' / un.</span><button type="button" class="icon-button" data-remove="' + id +
        '" aria-label="Remover ' + escape(product.name) + '">' + icon('trash') + '</button></div>';
    }).join('') || '<p class="empty">Selecione um produto para iniciar sua cotação.</p>';
    $('#cart-rate-note').textContent = sourceMessage(exchange) + ' Preços de produtos, sem frete ou tributos adicionais.';
    $('#cart-rate-note').hidden = false;
    $('#save-quote').disabled = !this.cart.size;
    this.renderCartTotal();
  }

  renderCartTotal() {
    const total = [...this.cart.entries()].reduce((sum, [id, quantity]) =>
      sum + this.prices.products.find((product) => product.id === id).unitMinor * quantity, 0);
    $('#cart-total').textContent = money(total, this.prices.market.currency);
  }

  async saveQuote(event) {
    event.preventDefault();
    if (!this.prices || !this.cart.size || this.busy) return;
    const form = event.target;
    const { market, exchange, products } = this.prices;
    const body = {
      requestKey: this.quoteKey,
      customer: form.elements.customer.value,
      countryCode: market.code, rate: exchange.rate, rateDate: exchange.date, source: exchange.source,
      items: [...this.cart.entries()].map(([id, quantity]) => ({
        id, quantity, unitMinor: products.find((product) => product.id === id).unitMinor
      }))
    };
    this.setFormBusy(form, true);
    $('#cart-error').hidden = true;
    let saved;
    try {
      saved = await this.api.request('quotes', 'POST', body);
    } catch (error) {
      if (error.status === 409) {
        await this.loadPrices();
        if (this.prices) this.renderCart();
      }
      this.formError('cart-error', this.errorMessage(error));
      return;
    } finally {
      this.setFormBusy(form, false);
    }
    this.cart.clear();
    this.quoteKey = crypto.randomUUID();
    form.reset();
    $('#cart-dialog').close();
    this.renderPrices();
    this.toast('Cotação salva com sucesso.');
    await this.changeView('quotes');
    this.renderDetail(saved);
  }

  async loadQuotes() {
    $('#quote-rows').innerHTML = '<tr><td colspan="6" class="empty">Carregando cotações…</td></tr>';
    try {
      const quotes = await this.api.request('quotes');
      $('#quote-rows').innerHTML = quotes.map((quote) => {
        const market = this.markets.find((entry) => entry.code === quote.countryCode);
        return '<tr><td class="quote-number">COT-' + String(quote.id).padStart(4, '0') +
          (quote.source === 'demo' ? '<small class="demo-label">Demonstração</small>' : '') + '</td><td>' + escape(quote.customer) +
          '</td><td>' + escape(market?.name || quote.countryCode) + '</td><td>' + date(quote.createdAt) + '</td><td class="numeric">' +
          money(quote.totalMinor, quote.currency) + '</td><td class="action-cell"><button class="text-button" data-detail="' +
          quote.id + '">Ver cotação</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="empty">Você ainda não criou cotações.<br>Use “Nova cotação” para começar.</td></tr>';
    } catch (error) {
      $('#quote-rows').innerHTML = '<tr><td colspan="6" class="empty">' + escape(this.errorMessage(error)) + '</td></tr>';
    }
  }

  async openDetail(id) {
    try {
      this.renderDetail(await this.api.request('quotes/' + id));
    } catch (error) {
      this.toast(this.errorMessage(error), true);
    }
  }

  renderDetail(quote) {
    const market = this.markets.find((entry) => entry.code === quote.countryCode);
    $('#detail-title').textContent = 'Cotação COT-' + String(quote.id).padStart(4, '0');
    $('#detail-subtitle').textContent = quote.customer + ' · ' + (market?.name || quote.countryCode) + ' · ' + date(quote.createdAt);
    $('#detail-body').innerHTML = '<p class="detail-meta">1 BRL = ' + escape(quote.rate) + ' ' + quote.currency +
      '<br>Lucro sobre o custo de 100% · Valores unitários arredondados na moeda de destino.<br>Preços de produtos, sem frete ou tributos adicionais.</p>' +
      (quote.source === 'demo' ? '<p class="notice">Demonstração · Esta cotação utiliza uma taxa ilustrativa.</p>' :
        '<p class="detail-meta">' + escape(sourceMessage({ source: quote.source, date: quote.rateDate })) + '</p>') +
      '<div class="detail-items">' + quote.items.map((item) => '<div class="detail-line"><div>' + escape(item.name) + '<small>' +
        escape(item.sku) + ' · ' + item.quantity + ' un. × ' + money(item.unitMinor, quote.currency) +
        '</small></div><strong>' + money(item.subtotalMinor, quote.currency) + '</strong></div>').join('') +
      '</div><div class="cart-total"><span>Total</span><strong>' + money(quote.totalMinor, quote.currency) + '</strong></div>';
    $('#detail-dialog').showModal();
  }

  formError(id, message) {
    $('#' + id).textContent = message;
    $('#' + id).hidden = false;
  }

  errorMessage(error) {
    if (error.name === 'TimeoutError' || error.name === 'TypeError') return 'Não foi possível conectar ao servidor. Verifique se a aplicação está em execução e tente novamente.';
    return error.message;
  }

  setFormBusy(form, busy) {
    this.busy = busy;
    form.querySelectorAll('input, select, button').forEach((element) => { element.disabled = busy; });
    if (!busy && form.id === 'cart-form') $('#save-quote').disabled = !this.cart.size || !this.prices;
  }

  toast(message, error = false) {
    clearTimeout(this.toastTimer);
    const element = $('#toast');
    element.textContent = message;
    element.className = 'toast' + (error ? ' error' : '');
    element.hidden = false;
    this.toastTimer = setTimeout(() => { element.hidden = true; }, error ? 6000 : 2600);
  }
}

const app = new BackOffice();
app.start();
