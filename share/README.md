# draw.land share store

A content-addressed blob endpoint for draw.land short links: `PUT /_share/<id>`
stores a script, `GET /_share/<id>` reads it back. The id is the `sha256` of the
script, so the same script is always the same blob — no accounts, no ownership,
no listing, nothing to edit. See `web/src/lib/share.js` for the client side and
`docs/` for why the URL form is the default and this is only a shortening.

## Deploy

```sh
cd share
npm install
npx wrangler r2 bucket create drawland   # once
npx wrangler deploy
```

The Worker is only the store; the site is hosted elsewhere (draw.land) and
calls it cross-origin, so it answers CORS. Scripts are kept under `scripts/`
in the bucket. Point the app at it with `VITE_SHARE_ENDPOINT` (see
`web/.env.example`) and rebuild the web app. A short link is always the
site's own address with the id, `https://draw.land/#s=<id>`: the store's
address never appears in it.

## What it will and will not do

- **Will** store any script under 64 KB whose id is one of ours, and serve it
  back with a long immutable cache (the name is the hash of the bytes).
- **Will not** list, search, edit, delete or authenticate. There is no such
  route. A write that is already there is a no-op.
- Writes are rate-limited per IP per minute; reads are not. Coordinates in a
  script locate a real place, so store no more than the script needs, and add
  a retention policy (an R2 lifecycle rule) when link rot becomes acceptable.
