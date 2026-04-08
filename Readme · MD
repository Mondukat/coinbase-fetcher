# coinbase-fetcher

Coinbase Advanced Trade API proxy for Railway. Pulls account balances, portfolios via JWT-authenticated CDP keys.

## Endpoints

| Route | What |
|---|---|
| `GET /balances` | All non-zero balances, auto-paginated, sorted by value |
| `GET /accounts` | Raw paginated account list |
| `GET /accounts/:uuid` | Single account detail |
| `GET /portfolios` | List portfolios |
| `GET /portfolios/:uuid` | Portfolio breakdown |

## Deploy to Railway

1. Create repo `Mondukat/coinbase-fetcher` on GitHub
2. Push these files via web editor
3. Railway → New Service → Deploy from GitHub repo
4. Set env vars in Railway:
   - `CDP_API_KEY_NAME` — your CDP key name string
   - `CDP_API_KEY_SECRET` — full EC PEM private key (use `\n` for newlines)
   - `ALLOWED_ORIGIN` — your frontend URL
5. Railway auto-detects Node, runs `npm start`

## Key Format

The `CDP_API_KEY_SECRET` needs to be the full PEM. In Railway env vars, paste it with literal `\n` for line breaks:

```
-----BEGIN EC PRIVATE KEY-----\nMHQCAQEE...\n-----END EC PRIVATE KEY-----
```

The code handles `\n` → real newline conversion.

## Wire into dashboard

```js
const CB_API = 'https://coinbase-fetcher-production.up.railway.app';
const { accounts } = await fetch(`${CB_API}/balances`).then(r => r.json());
```
