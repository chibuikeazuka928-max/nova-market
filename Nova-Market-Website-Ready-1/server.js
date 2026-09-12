 require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' })); // higher limit since product photos are sent as base64

// Basic security / caching headers for a public deployment.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static('public', { extensions: ['html'] }));

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Simple file-based product store — good for getting started.
// Swap for a real database (Supabase/Postgres/Mongo) before you have real concurrent traffic.
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

function loadProductsFromDisk() {
  try {
    return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveProductsToDisk(products) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

app.get('/api/products', (req, res) => {
  res.json(loadProductsFromDisk());
});

app.get('/api/products/:id', (req, res) => {
  const product = loadProductsFromDisk().find(
    p => String(p.id) === String(req.params.id)
  );

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json(product);
});

// Search-engine friendly product pages.
app.get('/product/:id', (req, res) => {
  const product = loadProductsFromDisk().find(
    p => String(p.id) === String(req.params.id)
  );

  if (!product) return res.status(404).send('Product not found');

  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const origin = `https://${req.get('host')}`;
  const url = `${origin}/product/${encodeURIComponent(product.id)}`;
  const title = esc(product.title);
  const description = esc(
    product.description || `Buy ${product.title} on Nova Market.`
  );

  const displayImage = product.image ? String(product.image) : '';
  const image = displayImage.startsWith('http') ? displayImage : '';

  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description || '',
    category: product.category || 'Other',
    ...(image ? { image: [image] } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: Number(product.price || 0),
      availability: 'https://schema.org/InStock',
      url
    }
  }).replace(/<\/script/gi, '<\\/script');

  res.send(`<!doctype html><html lang=\"en\"><head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
  <title>${title} | Nova Market</title>
  <meta name=\"description\" content=\"${description.slice(0, 155)}\">
  <link rel=\"canonical\" href=\"${esc(url)}\">
  <meta property=\"og:type\" content=\"product\">
  <meta property=\"og:title\" content=\"${title} | Nova Market\">
  <meta property=\"og:description\" content=\"${description.slice(0, 200)}\">
  ${image ? `<meta property=\"og:image\" content=\"${esc(image)}\">` : ''}
  <script type=\"application/ld+json\">${schema}</script>
  <style>body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1b1b18;background:#f1eee6}a{color:#1f3d2b}.card{background:#fff;border:1px solid #d8d2c2;padding:24px}.price{font-size:24px;font-weight:700;color:#1f3d2b}.thumb{max-width:600px;max-height:500px;overflow:hidden;margin:18px 0}.thumb img{width:100%;height:auto}</style>
  </head><body><p><a href=\"/\">← Nova Market</a></p><main class=\"card\"><small>${esc(product.category || 'Other')}</small><h1>${title}</h1><div class=\"thumb\">${displayImage ? `<img src=\"${esc(displayImage)}\" alt=\"${title}\">` : 'No photo available'}</div><p>${description}</p><p class=\"price\">$${Number(product.price || 0).toFixed(2)}</p><p><a href=\"/\">Add this item to your cart on Nova Market →</a></p></main></body></html>`);
});

app.get('/robots.txt', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const origin = `https://${req.get('host')}`;
  const products = loadProductsFromDisk();

  const urls = [
    `${origin}/`,
    ...products.map(
      p => `${origin}/product/${encodeURIComponent(p.id)}`
    )
  ];

  const body = urls
    .map(u => `<url><loc>${escXml(u)}</loc></url>`)
    .join('');

  res
    .type('application/xml')
    .send(
      `<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">${body}</urlset>`
    );
});

function escXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

app.post('/api/products', (req, res) => {
  const product = req.body;

  if (!product || !product.title || typeof product.price !== 'number') {
    return res.status(400).json({ error: 'Invalid product' });
  }

  const products = loadProductsFromDisk();
  products.unshift(product);
  saveProductsToDisk(products);

  res.json({ ok: true });
});

// Built-in Nova Market assistant.
// This version does NOT require an external AI API key.
app.post('/api/chat', (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const question = String(prompt).toLowerCase().trim();
  const products = loadProductsFromDisk();

  let text;

  if (
    question.includes('hello') ||
    question.includes('hi') ||
    question.includes('hey')
  ) {
    text = "Hey! 👋 Welcome to Nova Market. How can I help you today?";
  } else if (
    question.includes('what is nova market') ||
    question.includes('what is nova')
  ) {
    text = "Nova Market is an online marketplace where you can browse products, add items to your cart, and check out.";
  } else if (
    question.includes('product') ||
    question.includes('what do you sell') ||
    question.includes('what do you have')
  ) {
    if (products.length === 0) {
      text = "There aren't any products listed yet. Check back soon!";
    } else {
      const names = products
        .slice(0, 8)
        .map(p => p.title)
        .join(', ');

      text = `We currently have these products listed: ${names}.`;
    }
  } else if (
    question.includes('buy') ||
    question.includes('purchase') ||
    question.includes('order')
  ) {
    text = "To buy something, choose a product, add it to your cart, then use the checkout option to complete your order.";
  } else if (question.includes('cart')) {
    text = "Your cart contains the products you've selected. Open the cart, review your items, and continue to checkout when you're ready.";
  } else if (
    question.includes('checkout') ||
    question.includes('payment') ||
    question.includes('pay')
  ) {
    text = "Nova Market uses the checkout system to process payments securely. Add your items to the cart and continue to checkout.";
  } else if (
    question.includes('help') ||
    question.includes('how')
  ) {
    text = "I can help with Nova Market products, buying, your cart, checkout, and general questions about the website. What would you like to know?";
  } else {
    text = "I'm Nova Market's built-in assistant. I can help you find products, explain how to buy something, use your cart, or understand checkout. Try asking me one of those!";
  }

  res.json({ text });
});

// Checkout endpoint: creates a Stripe-hosted payment page for the cart.
// Card details are entered on Stripe's page, never on this server.
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({
      error: 'Server is missing STRIPE_SECRET_KEY. Add it to your .env file.'
    });
  }

  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items in cart' });
    }

    const line_items = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: String(item.title).slice(0, 250)
        },
        unit_amount: Math.round(Number(item.price) * 100)
      },
      quantity: item.quantity || 1
    }));

    const origin =
      req.headers.origin ||
      `http://localhost:${process.env.PORT || 3000}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      success_url: `${origin}/success.html`,
      cancel_url: `${origin}/cancel.html`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Could not create checkout session'
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>
  console.log(`Nova Market server running at http://localhost:${PORT}`)
);