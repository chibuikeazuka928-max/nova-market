# Nova Market — full version

This is the real, self-hostable version of the store: a small server handles the
AI features and payments, so your API keys stay private and Stripe handles all
card data (this app never sees or stores a card number).

## 1. Install

You'll need [Node.js](https://nodejs.org) version 18 or newer installed.

```
cd nova-market-app
npm install
```

## 2. Add your keys

```
cp .env.example .env
```

Open `.env` and fill in:

- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com) (Settings → API Keys)
- `STRIPE_SECRET_KEY` — from [dashboard.stripe.com](https://dashboard.stripe.com/apikeys). Use the key starting with `sk_test_` while you're testing — no real money moves with test keys.

Never commit your real `.env` file to GitHub — `.env.example` is just a template.

## 3. Run it locally

```
npm start
```

Visit `http://localhost:3000`. Listings you add are saved to `products.json` on
the server (visible to anyone who visits the site). The cart and dark-mode
preference are saved in each visitor's own browser.

## 4. Google search visibility

This version now includes:
- crawlable `/product/:id` pages for individual listings
- Product structured data (`Product` + `Offer`)
- `/robots.txt` and a dynamic `/sitemap.xml`
- canonical and Open Graph metadata
- marketplace search and category filtering

After deploying to a real domain, verify the domain in Google Search Console and submit the site's `/sitemap.xml`. Google may take time to crawl and rank new pages; having a sitemap does not guarantee a top result.

## 5. Test a payment safely

With a Stripe **test** key, use Stripe's test card number `4242 4242 4242 4242`,
any future expiry date, and any 3-digit CVC. No real charge happens.

## 6. Go live

**Connect Stripe to your bank account:** in the Stripe dashboard, finish
"Activate your account" — this is where you link your real bank account for
payouts. Do this before switching to your live (`sk_live_...`) key.

**Deploy the server:** this app needs a server that stays running (not a
static host), so easy options are:
- [Render](https://render.com) — free tier, connect your GitHub repo, set the same environment variables from your `.env`
- [Railway](https://railway.app) — similar, usage-based pricing

Push this folder to a GitHub repo, then connect that repo on either platform
and add your environment variables in their dashboard (same names as `.env`).

**Add a domain:** buy one (Namecheap, Squarespace Domains, etc.) and point it
at your Render/Railway deployment following their custom-domain instructions.

**Get found on Google:** once live, submit your site in
[Google Search Console](https://search.google.com/search-console). Actual
ranking takes time and content — it's not automatic.

## Notes on what's still a starting point, not production-grade

- `products.json` is a flat file — fine for one small server, but swap for a
  real database (Postgres, Supabase, MongoDB) once you expect real concurrent
  traffic or want product editing/deletion.
- There's no seller login/authentication yet — right now, anyone visiting the
  site can list a product. Add accounts before this is a multi-seller
  marketplace.
- Add order storage (saving what was purchased) if you need order history —
  currently Stripe has the payment record, but nothing links it back to which
  product doc left your file.
