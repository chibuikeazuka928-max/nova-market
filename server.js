require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
// Stripe webhook must receive the raw request body before express.json() parses it.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.use(express.json({ limit: '5mb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use(express.static('public', { extensions: ['html'] }));

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const PRODUCTS_FILE = path.join(__dirname, 'products.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const adminSessions = new Map();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function loadProductsFromDisk() { return readJson(PRODUCTS_FILE, []); }
function saveProductsToDisk(products) { writeJson(PRODUCTS_FILE, products); }
function loadOrdersFromDisk() { return readJson(ORDERS_FILE, []); }
function saveOrdersToDisk(orders) { writeJson(ORDERS_FILE, orders); }
function newId(prefix) { return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`; }
function isAdmin(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const expires = adminSessions.get(token);
  if (!expires || expires < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin password is not configured.' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/products', (req, res) => res.json(loadProductsFromDisk()));

app.get('/api/products/:id', (req, res) => {
  const product = loadProductsFromDisk().find(p => String(p.id) === String(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.get('/product/:id', (req, res) => {
  const product = loadProductsFromDisk().find(p => String(p.id) === String(req.params.id));
  if (!product) return res.status(404).send('Product not found');

  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  const origin = `https://${req.get('host')}`;
  const url = `${origin}/product/${encodeURIComponent(product.id)}`;
  const title = esc(product.title);
  const description = esc(product.description || `Buy ${product.title} on Nova Market.`);
  const displayImage = product.image ? String(product.image) : '';
  const image = displayImage.startsWith('http') ? displayImage : '';
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description || '',
    category: product.category || 'Other',
    ...(image ? { image: [image] } : {}),
    offers: { '@type': 'Offer', priceCurrency: 'USD', price: Number(product.price || 0), availability: 'https://schema.org/InStock', url }
  }).replace(/<\/script/gi, '<\\/script');

  res.send(`<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} | Nova Market</title><meta name="description" content="${description.slice(0, 155)}">
  <link rel="canonical" href="${esc(url)}"><meta property="og:type" content="product">
  <meta property="og:title" content="${title} | Nova Market"><meta property="og:description" content="${description.slice(0, 200)}">
  ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}<script type="application/ld+json">${schema}</script>
  <style>body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1b1b18;background:#f1eee6}a{color:#1f3d2b}.card{background:#fff;border:1px solid #d8d2c2;padding:24px}.price{font-size:24px;font-weight:700;color:#1f3d2b}.thumb{max-width:600px;max-height:500px;overflow:hidden;margin:18px 0}.thumb img{width:100%;height:auto}</style>
  </head><body><p><a href="/">← Nova Market</a></p><main class="card"><small>${esc(product.category || 'Other')}</small><h1>${title}</h1><div class="thumb">${displayImage ? `<img src="${esc(displayImage)}" alt="${title}">` : 'No photo available'}</div><p>${description}</p><p class="price">$${Number(product.price || 0).toFixed(2)}</p><p><a href="/">Add this item to your cart on Nova Market →</a></p></main></body></html>`);
});

app.get('/robots.txt', (req, res) => {
  const origin = `https://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const origin = `https://${req.get('host')}`;
  const products = loadProductsFromDisk();
  const urls = [`${origin}/`, ...products.map(p => `${origin}/product/${encodeURIComponent(p.id)}`)];
  const body = urls.map(u => `<url><loc>${escXml(u)}</loc></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
});

function escXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;');
}

// Public listing endpoint. Kept for compatibility with the current frontend.
app.post('/api/products', (req, res) => {
  const product = req.body;
  if (!product || !product.title || typeof product.price !== 'number' || product.price < 0) {
    return res.status(400).json({ error: 'Invalid product' });
  }
  const products = loadProductsFromDisk();
  const safeProduct = {
    id: product.id || newId('p'),
    title: String(product.title).slice(0, 160),
    category: String(product.category || 'Other').slice(0, 80),
    price: Number(product.price),
    description: String(product.description || 'No description provided.').slice(0, 2000),
    image: typeof product.image === 'string' ? product.image : null
  };
  products.unshift(safeProduct);
  saveProductsToDisk(products);
  res.json({ ok: true, product: safeProduct });
});

// ---------------- ADMIN / SELLER DASHBOARD ----------------
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Set ADMIN_PASSWORD in Render environment variables first.' });
  const password = String(req.body?.password || '');
  const provided = crypto.createHash('sha256').update(password).digest();
  const expected = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (password.length < 1 || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + 1000 * 60 * 60 * 12);
  res.json({ token, expiresIn: 43200 });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  adminSessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(loadOrdersFromDisk().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const allowed = ['pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];
  const status = String(req.body?.status || '');
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid order status' });
  const orders = loadOrdersFromDisk();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveOrdersToDisk(orders);
  res.json({ ok: true, order });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const product = req.body || {};
  if (!product.title || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) {
    return res.status(400).json({ error: 'Title and valid price are required.' });
  }
  const products = loadProductsFromDisk();
  const safeProduct = {
    id: newId('p'),
    title: String(product.title).slice(0, 160),
    category: String(product.category || 'Other').slice(0, 80),
    price: Number(product.price),
    description: String(product.description || 'No description provided.').slice(0, 2000),
    image: typeof product.image === 'string' ? product.image : null
  };
  products.unshift(safeProduct);
  saveProductsToDisk(products);
  res.json({ ok: true, product: safeProduct });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = loadProductsFromDisk();
  const next = products.filter(p => String(p.id) !== String(req.params.id));
  if (next.length === products.length) return res.status(404).json({ error: 'Product not found' });
  saveProductsToDisk(next);
  res.json({ ok: true });
});

// ---------------- ORDERS + STRIPE ----------------
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not connected yet. Add STRIPE_SECRET_KEY to Render.' });
  try {
    const { items, customer } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items in cart' });
    if (!customer?.name || !customer?.email || !customer?.address) return res.status(400).json({ error: 'Customer name, email and shipping address are required.' });

    const products = loadProductsFromDisk();
    const normalized = items.map(item => {
      const p = products.find(x => String(x.id) === String(item.id));
      if (!p) throw new Error(`Product not found: ${item.id}`);
      const quantity = Math.max(1, Math.min(20, Number(item.quantity) || 1));
      return { id: p.id, title: p.title, price: Number(p.price), quantity };
    });

    const total = normalized.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const order = {
      id: newId('order'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending_payment',
      customer: { name: String(customer.name).slice(0, 120), email: String(customer.email).slice(0, 200), address: String(customer.address).slice(0, 500) },
      items: normalized,
      total
    };
    const orders = loadOrdersFromDisk();
    orders.unshift(order);
    saveOrdersToDisk(orders);

    const origin = req.headers.origin || `https://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: normalized.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: { name: item.title },
          unit_amount: Math.round(item.price * 100)
        },
        quantity: item.quantity
      })),
      customer_email: order.customer.email,
      metadata: { orderId: order.id },
      success_url: `${origin}/success.html?order=${encodeURIComponent(order.id)}`,
      cancel_url: `${origin}/cancel.html?order=${encodeURIComponent(order.id)}`
    });

    order.stripeSessionId = session.id;
    saveOrdersToDisk(orders);
    res.json({ url: session.url, orderId: order.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

// Stripe calls this handler after payment events. Configure the webhook in Stripe.
function stripeWebhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Webhook not configured');
  let event;
  try {
    event = Stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orders = loadOrdersFromDisk();
    const order = orders.find(o => o.id === session.metadata?.orderId);
    if (order) {
      order.status = 'paid';
      order.updatedAt = new Date().toISOString();
      saveOrdersToDisk(orders);
      console.log(`Nova Market order paid: ${order.id}`);
    }
  }
  res.json({ received: true });
}

// Built-in assistant — no external AI API required.
app.post('/api/chat', (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const question = String(prompt).toLowerCase().trim();
  const products = loadProductsFromDisk();
  let text;

  const matches = products.filter(p => `${p.title} ${p.category} ${p.description}`.toLowerCase().includes(question));
  if (question.includes('hello') || question.includes('hi') || question.includes('hey')) {
    text = "Hey! 👋 Welcome to Nova Market. What are you looking for?";
  } else if (question.includes('product') || question.includes('sell') || question.includes('have')) {
    text = products.length ? `We currently have ${products.length} listed item${products.length === 1 ? '' : 's'}. ${products.slice(0, 6).map(p => `${p.title} ($${Number(p.price).toFixed(2)})`).join(', ')}.` : "There aren't any products listed yet. Check back soon!";
  } else if (matches.length) {
    text = `I found ${matches.slice(0, 5).map(p => `${p.title} for $${Number(p.price).toFixed(2)}`).join(', ')}.`;
  } else if (question.includes('buy') || question.includes('purchase') || question.includes('order')) {
    text = "Choose a product, add it to your cart, enter your delivery details, then continue to checkout.";
  } else if (question.includes('cart')) {
    text = "Open your cart to review your items, remove products, and continue to checkout.";
  } else if (question.includes('checkout') || question.includes('payment') || question.includes('pay')) {
    text = "Checkout will take you to the payment provider when real payments are connected. Your card details should never be stored by Nova Market.";
  } else if (question.includes('nova market') || question.includes('what is nova')) {
    text = "Nova Market is an online marketplace where people can discover products and, once the store is fully connected, buy and sell items online.";
  } else {
    text = "I can help you find products, explain how to buy something, use your cart, or understand checkout. Try asking what products are available.";
  }
  res.json({ text });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nova Market server running at http://localhost:${PORT}`));
