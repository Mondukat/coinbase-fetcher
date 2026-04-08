import express from 'express';
import crypto from 'crypto';
import { SignJWT, importPKCS8 } from 'jose';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config ──────────────────────────────────────────────────────────
const CDP_API_KEY_NAME = process.env.CDP_API_KEY_NAME;       // "organizations/{org_id}/apiKeys/{key_id}"
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;   // EC private key PEM
const COINBASE_API = 'https://api.coinbase.com';

// ── CORS ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── JWT Generator ───────────────────────────────────────────────────
async function generateJWT(method, path) {
  const uri = `${method} ${new URL(path, COINBASE_API).host}${new URL(path, COINBASE_API).pathname}`;
  
  // CDP keys can be either EC (ES256) or ED25519
  // The Advanced Trade API uses EC keys
  const privateKey = await importPKCS8(
    CDP_API_KEY_SECRET.replace(/\\n/g, '\n'), 
    'ES256'
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  
  const jwt = await new SignJWT({
    sub: CDP_API_KEY_NAME,
    iss: 'cdp',
    aud: ['retail_rest_api_proxy'],
    uri,
    nbf: Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({ alg: 'ES256', kid: CDP_API_KEY_NAME, nonce, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(privateKey);

  return jwt;
}

// ── Coinbase API proxy ──────────────────────────────────────────────
async function coinbaseFetch(method, path) {
  const jwt = await generateJWT(method, path);
  const res = await fetch(`${COINBASE_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Coinbase API ${res.status}: ${err}`);
  }
  
  return res.json();
}

// ── Routes ──────────────────────────────────────────────────────────

// List all accounts with balances (paginated)
app.get('/accounts', async (req, res) => {
  try {
    const limit = req.query.limit || 250;
    const cursor = req.query.cursor || '';
    const path = `/api/v3/brokerage/accounts?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
    const data = await coinbaseFetch('GET', path);
    res.json(data);
  } catch (err) {
    console.error('accounts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get all accounts (auto-paginate, return only non-zero balances)
app.get('/balances', async (req, res) => {
  try {
    let allAccounts = [];
    let cursor = '';
    let hasNext = true;
    
    while (hasNext) {
      const path = `/api/v3/brokerage/accounts?limit=250${cursor ? `&cursor=${cursor}` : ''}`;
      const data = await coinbaseFetch('GET', path);
      allAccounts = allAccounts.concat(data.accounts || []);
      hasNext = data.has_next;
      cursor = data.cursor || '';
    }
    
    // Filter to non-zero balances
    const withBalance = allAccounts.filter(a => {
      const bal = parseFloat(a.available_balance?.value || '0');
      const hold = parseFloat(a.hold?.value || '0');
      return bal > 0 || hold > 0;
    });
    
    // Sort by available balance descending
    withBalance.sort((a, b) => 
      parseFloat(b.available_balance?.value || '0') - parseFloat(a.available_balance?.value || '0')
    );
    
    res.json({
      total_accounts: allAccounts.length,
      with_balance: withBalance.length,
      accounts: withBalance.map(a => ({
        uuid: a.uuid,
        name: a.name,
        currency: a.currency,
        available: a.available_balance?.value || '0',
        hold: a.hold?.value || '0',
        type: a.type,
        platform: a.platform,
        ready: a.ready,
      })),
    });
  } catch (err) {
    console.error('balances error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// List portfolios
app.get('/portfolios', async (req, res) => {
  try {
    const data = await coinbaseFetch('GET', '/api/v3/brokerage/portfolios');
    res.json(data);
  } catch (err) {
    console.error('portfolios error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get specific portfolio breakdown
app.get('/portfolios/:uuid', async (req, res) => {
  try {
    const data = await coinbaseFetch('GET', `/api/v3/brokerage/portfolios/${req.params.uuid}`);
    res.json(data);
  } catch (err) {
    console.error('portfolio error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get a single account by UUID
app.get('/accounts/:uuid', async (req, res) => {
  try {
    const data = await coinbaseFetch('GET', `/api/v3/brokerage/accounts/${req.params.uuid}`);
    res.json(data);
  } catch (err) {
    console.error('account error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'coinbase-fetcher',
    endpoints: ['/balances', '/accounts', '/portfolios', '/portfolios/:uuid', '/accounts/:uuid'],
  });
});

app.listen(PORT, () => console.log(`coinbase-fetcher running on :${PORT}`));
