process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');

dotenv.config();
console.log('SoSoValue Key loaded:', process.env.SOSOVALUE_API_KEY ? '✅ Found' : '❌ Missing');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SOSO_BASE = 'https://openapi.sosovalue.com/api/v1';
const SOSO_HEADERS = { 'x-soso-api-key': process.env.SOSOVALUE_API_KEY };
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// ── 1. SoSoValue News ──────────────────────────────────────────
async function fetchNews() {
  try {
    const res = await axios.get(
      `${SOSO_BASE}/news/featured?pageNum=1&pageSize=8`,
      { headers: SOSO_HEADERS }
    );
    const items = res.data?.data?.list || [];
    return items.map(n => {
      const en = n.multilanguageContent?.find(c => c.language === 'en');
      const category = {
        1: 'News', 2: 'Research', 3: 'Institution',
        4: 'Insights', 5: 'Macro', 6: 'Macro Research',
        7: 'Official Tweet', 9: 'Price Alert', 10: 'On-Chain'
      }[n.category] || 'News';
      return `[${category}] ${en?.title || 'Untitled'} (${new Date(n.releaseTime).toLocaleDateString()})`;
    }).join('\n');
  } catch (e) {
    console.error('News fetch error:', e.message);
    return 'News unavailable';
  }
}

// ── 2. SoSoValue ETF Metrics ────────────────────────────────────
async function fetchETF() {
  try {
    const [btcRes, ethRes] = await Promise.all([
      axios.post(
        'https://api.sosovalue.xyz/openapi/v2/etf/currentEtfDataMetrics',
        JSON.stringify({type: 'us-btc-spot'}),
        { headers: { 'x-soso-api-key': process.env.SOSOVALUE_API_KEY, 'Content-Type': 'application/json' } }
      ),
      axios.post(
        'https://api.sosovalue.xyz/openapi/v2/etf/currentEtfDataMetrics',
        JSON.stringify({type: 'us-eth-spot'}),
        { headers: { 'x-soso-api-key': process.env.SOSOVALUE_API_KEY, 'Content-Type': 'application/json' } }
      )
    ]);

    const btc = btcRes.data?.data;
    const eth = ethRes.data?.data;

    const formatUSD = (val) => val ? `$${(val / 1e9).toFixed(2)}B` : 'N/A';
    const formatFlow = (val) => {
      if (!val && val !== 0) return 'N/A';
      const b = (val / 1e6).toFixed(1);
      return val >= 0 ? `+$${b}M` : `-$${Math.abs(b)}M`;
    };

    const btcSummary = btc ? `BTC ETFs — Net Assets: ${formatUSD(btc.totalNetAssets?.value)} | Daily Inflow: ${formatFlow(btc.dailyNetInflow?.value)} | Cumulative Inflow: ${formatUSD(btc.cumNetInflow?.value)} | BTC Holdings: ${btc.totalTokenHoldings?.value?.toLocaleString() || 'N/A'} BTC` : 'BTC ETF data unavailable';

    const ethSummary = eth ? `ETH ETFs — Net Assets: ${formatUSD(eth.totalNetAssets?.value)} | Daily Inflow: ${formatFlow(eth.dailyNetInflow?.value)} | Cumulative Inflow: ${formatUSD(eth.cumNetInflow?.value)}` : 'ETH ETF data unavailable';

    // Top 3 ETFs by net assets
    const topEtfs = btc?.list
      ?.filter(e => e.netAssets?.value)
      ?.sort((a, b) => b.netAssets.value - a.netAssets.value)
      ?.slice(0, 3)
      ?.map(e => `  ${e.ticker} (${e.institute}): ${formatUSD(e.netAssets.value)} | Daily: ${formatFlow(e.dailyNetInflow?.value)}`)
      ?.join('\n') || '';

    return `${btcSummary}\n${ethSummary}\nTop BTC ETFs:\n${topEtfs}`;

  } catch (e) {
    console.error('ETF fetch error:', e.message);
    return 'ETF data unavailable';
  }
}

// ── 3. CoinGecko Live Prices ────────────────────────────────────
async function fetchPrices() {
  try {
    const res = await axios.get(
      `${COINGECKO_BASE}/simple/price?ids=bitcoin,ethereum,solana,binancecoin,ripple&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
      { timeout: 8000 }
    );
    const d = res.data;
    const format = (id, name) => {
      const coin = d[id];
      if (!coin) return '';
      const change = coin.usd_24h_change?.toFixed(2);
      const direction = change >= 0 ? '▲' : '▼';
      const cap = (coin.usd_market_cap / 1e9).toFixed(1);
      return `${name}: $${coin.usd.toLocaleString()} ${direction}${Math.abs(change)}% | Market Cap: $${cap}B`;
    };
    return [
      format('bitcoin', 'BTC'),
      format('ethereum', 'ETH'),
      format('solana', 'SOL'),
      format('binancecoin', 'BNB'),
      format('ripple', 'XRP'),
    ].filter(Boolean).join('\n');
  } catch (e) {
    console.error('Price fetch error:', e.message);
    return 'Live prices temporarily unavailable';
  }
}

// ── 4. CoinGecko Market Trends ──────────────────────────────────
async function fetchTrends() {
  try {
    const res = await axios.get(
      `${COINGECKO_BASE}/global`,
      { timeout: 8000 }
    );
    const d = res.data?.data;
    if (!d) return '';
    const fearGreed = d.market_cap_change_percentage_24h_usd?.toFixed(2);
    const btcDom = d.market_cap_percentage?.btc?.toFixed(1);
    const totalCap = (d.total_market_cap?.usd / 1e12).toFixed(2);
    return `Total Crypto Market Cap: $${totalCap}T | BTC Dominance: ${btcDom}% | 24h Market Change: ${fearGreed}%`;
  } catch (e) {
    console.error('Trends fetch error:', e.message);
    return '';
  }
}

// ── 5. Build Full Market Context ────────────────────────────────
async function buildMarketContext() {
  const [news, etf, prices, trends] = await Promise.all([
    fetchNews(),
    fetchETF(),
    fetchPrices(),
    fetchTrends()
  ]);

  return `
=== LIVE OVOWORKS MARKET DATA (${new Date().toUTCString()}) ===

📈 LIVE CRYPTO PRICES (CoinGecko):
${prices}

🌍 GLOBAL MARKET:
${trends}

🏦 BTC ETF METRICS (SoSoValue Terminal):
${etf}

📰 LATEST CRYPTO NEWS (SoSoValue Terminal):
${news}

=== END OF LIVE DATA ===
`.trim();
}

// ── System Prompt ───────────────────────────────────────────────
const SYSTEM_PROMPT = `You are OvoWorks — a sharp, intelligent OnChain Finance Copilot built on SoSoValue's infrastructure.

You receive LIVE market data before every user message. This includes:
- Real-time crypto prices from CoinGecko
- Global market metrics (dominance, total market cap)
- Bitcoin & Ethereum ETF flows from SoSoValue Terminal
- Latest crypto news and institutional activity from SoSoValue

Your job is to synthesize this live data into clear, actionable intelligence.

HOW TO ANSWER:
- Always reference the actual live numbers you received — never say you don't have data
- For "should I buy/sell" questions: analyze ETF flows (institutional direction) + price trend + news sentiment together and give a clear data-driven view
- For "what are big institutions doing" questions: use ETF inflow/outflow data — it directly shows what BlackRock, Fidelity etc. are doing
- For "what should I do alongside them" questions: explain how retail investors can position alongside institutional ETF flows
- Always end with one sharp, specific actionable insight
- Keep responses under 220 words — be a sharp analyst, not an essay writer
- Use numbers from the live data — specific figures build trust
- Frame everything as data-driven insights, never direct financial advice
- End with DYOR for major decisions

You are not a generic chatbot. You are a real-time financial intelligence tool.`;

// ── Chat Endpoint ───────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  try {
    const marketContext = await buildMarketContext();

    const enrichedMessages = [...messages];
    const lastMsg = enrichedMessages[enrichedMessages.length - 1];
    enrichedMessages[enrichedMessages.length - 1] = {
      role: 'user',
      content: `${marketContext}\n\nUser question: ${lastMsg.content}`
    };

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: enrichedMessages
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    res.json({ reply: response.data.content[0].text });

  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ OvoWorks running at http://0.0.0.0:${PORT}`);
  console.log(`📊 Live data: CoinGecko + SoSoValue Terminal`);
  console.log(`🤖 AI: Claude Sonnet 4.6`);
});