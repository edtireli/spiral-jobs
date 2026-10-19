# Optional free link analytics

A small Cloudflare Worker gives each application an opaque URL and redirects it to this repository. The Mac does not host the endpoint and no router ports, public IP configuration, domain purchase or DuckDNS changes are needed. The service uses a `workers.dev` address and Workers KV.

Cloudflare's free tier has usage limits. Consult [current Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) before deploying. No paid plan is required for ordinary small-scale use.

## Deploy to your account

```sh
cd tracking
npm ci
npx wrangler login --scopes account:read user:read workers_scripts:write workers_kv:write
npx wrangler kv namespace create LINKS
```

Copy `wrangler.json` to ignored `wrangler.local.json` and replace the namespace ID. The destination must be a fixed HTTPS GitHub repo or GitHub Pages URL. Then generate a random 32-byte hex key, keep it in your password manager, and enter it at the secret prompt:

```sh
openssl rand -hex 32
npx wrangler secret put ADMIN_KEY --config wrangler.local.json
npx wrangler deploy --config wrangler.local.json
```

In Spiral Jobs → Settings → Project link analytics, enter the returned origin and private key. Enable the project footer in Profile. Each newly prepared application gets a different registered link; the local job record retains the matching company. The key never goes into the PDF or public URL.

## Behaviour

- `GET /r/<random ID>` records the visit and redirects to the fixed destination.
- `HEAD` redirects without generating a visit.
- Unknown IDs and unauthenticated admin requests return 404.
- `/privacy` explains IP/time/user-agent logging, the 30-day retention and scanner limitations.
- Only authenticated requests can create links or read their visits. Logs do not contain CVs or employer names.

The footer labels tracked links as visit analytics. Security scanners and shared links can generate events; a visit does not identify a recruiter. Quotas and eventual consistency can omit or delay results. The Worker deliberately has no configurable proxy endpoint or route to the Mac.

## Local test

From the repository root, run `node --test tests/tracking.test.mjs`. These tests use an in-memory KV fixture; validate a deployed synthetic link before placing links in real applications.
