const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const CDP_API_KEY_NAME = process.env.CDP_API_KEY_NAME || '';
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET || '';
const COINBASE_API = 'https://api.coinbase.com';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

let _jose = null;
async function getJose() {
  if (!_jose) _jose = await import('jose');
  return _jose;
}

async function generateJWT(method, path) {
  const jose = await getJose();
  const url = new URL(path, COINBASE_API);
  const uri = `${method} ${url.host}${url.pathname}`;
  const privateKey = await jose.importPKCS8(
    CDP_API_KEY_SECRET.replace(/\\n/g, '\n'),
    'ES256'
  );
  const nonce = crypto.randomBytes(16).toString('hex');
  const jwt = await new jose.SignJWT({
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
    const withBalance = allAccounts.filter(a => {
      const bal = parseFloat(a.available_balance?.value || '0');
      const hold = parseFloat(a.hold?.value || '0');
      return bal > 0 || hold > 0;
    });
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

app.get('/portfolios', async (req, res) => {
  try {
    const data = await coinbaseFetch('GET', '/api/v3/brokerage/portfolios');
    res.json(data);
  } catch (err) {
    console.error('portfolios error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/portfolios/:uuid', async (req, res) => {
  try {
    const data = await coinbaseFetch('GET', `/api/v3/brokerage/portfolios/${req.params.uuid}`);
    res.json(data);
  } catch (err) {
    console.error('portfolio error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/accounts/:uuid', async (req, res) => {
  try {
    const data = await coinbaseFetch('GET', `/api/v3/brokerage/accounts/${req.params.uuid}`);
    res.json(data);
  } catch (err) {
    console.error('account error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'coinbase-fetcher',
    configured: !!(CDP_API_KEY_NAME && CDP_API_KEY_SECRET),
    endpoints: ['/balances', '/accounts', '/portfolios', '/portfolios/:uuid', '/accounts/:uuid'],
  });
});

app.listen(PORT, () => console.log(`coinbase-fetcher running on :${PORT}`));
