# Nova Market

A Node/Express online marketplace starter with product listings, a seller/admin dashboard, orders, SEO-friendly product pages, and Stripe checkout hooks.

## Local run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Seller/admin dashboard

Open `/admin.html`.

Set `ADMIN_PASSWORD` in the server environment before logging in. The dashboard can add/delete products and view/update orders.

## Real payments

Set:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Create a Stripe webhook pointing to `/api/stripe-webhook` and subscribe to `checkout.session.completed`.

## Important production note

`products.json` and `orders.json` are intentionally simple starter storage. On Render's normal filesystem, local files should not be treated as permanent production storage. Before taking real customer orders at scale, move products/orders to a persistent database such as Postgres/Supabase.

## SEO

The server provides `/robots.txt`, `/sitemap.xml`, and individual `/product/:id` pages with Product structured data.
