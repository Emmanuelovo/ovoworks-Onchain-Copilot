process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');

dotenv.config();

const { placeSpotOrder, getSpotBalance } = require('./traders/spot');
const { placeFuturesOrder, getFuturesBalance } = require('./traders/futures');

// In-memory history stores
const signalHistory = [];
const tradeHistory = [];

// Session memory store
const sessionMemory = {};
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

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

async function fetchETFHistory() {
  // Temporarily disabled pending API key reset
  return { btcList: [], ethList: [] };
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
const SYSTEM_PROMPT = `You are OvoWorks — a sharp, decisive OnChain Finance Copilot built on SoSoValue's infrastructure.

You receive LIVE market data before every user message including real-time crypto prices, global market metrics, Bitcoin and Ethereum ETF flows from SoSoValue Terminal, and latest crypto news.

You have full conversation memory and remember everything discussed in this session.

HOW TO ANSWER:

For market questions:
- Use the actual live numbers you received — never say you don't have data
- Be specific and reference exact figures

For "should I buy/sell" or signal questions:
- Give a CLEAR decisive signal: BUY, SELL, or HOLD
- State the signal prominently at the start
- Back it up with 2-3 specific data points from live data
- Give a specific entry price, suggested position size, and stop loss level
- Example format: "SIGNAL: BUY — BTC at $79,500 with +$532M ETF inflow today. Entry: $79,500. Target: $82,000. Stop: $77,000."

For institutional activity questions:
- Reference specific ETF holders (BlackRock IBIT, Fidelity FBTC, Grayscale GBTC)
- Show exact dollar flows

For follow-up questions:
- Remember the asset being discussed — if user asked about BTC then asks "what about its ETF?" you already know they mean BTC ETF
- Build on previous answers in the conversation

RULES:
- Always end with one sharp actionable insight
- Keep responses under 200 words
- Use actual numbers from live data
- Always add DYOR disclaimer for major decisions
- Frame signals as data-driven analysis, not financial advice`;

// ── Chat Endpoint ───────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, sessionId } = req.body;

  try {
    // Get or create session memory
    const sid = sessionId || 'default';
    if (!sessionMemory[sid]) {
      sessionMemory[sid] = {
        history: [],
        lastActive: Date.now()
      };
    }

    const session = sessionMemory[sid];
    session.lastActive = Date.now();

    // Get the latest user message
    const latestMessage = messages[messages.length - 1];

    // Add to session history
    session.history.push(latestMessage);

    // Keep last 20 messages (10 exchanges)
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }

    // Fetch live market data
    const marketContext = await buildMarketContext();

    // Build enriched messages with full history
    const enrichedMessages = [
      ...session.history.slice(0, -1), // previous messages
      {
        role: 'user',
        content: `${marketContext}\n\nUser question: ${latestMessage.content}`
      }
    ];

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

    const reply = response.data.content[0].text;

    // Save assistant reply to session history
    session.history.push({
      role: 'assistant',
      content: reply
    });

    // Clean up old sessions every hour
    const now = Date.now();
    Object.keys(sessionMemory).forEach(key => {
      if (now - sessionMemory[key].lastActive > SESSION_TIMEOUT) {
        delete sessionMemory[key];
      }
    });

    // Build source tags based on what data was available
const sources = [];
if (marketContext.includes('BTC ETF')) sources.push('SoSoValue Terminal');
if (marketContext.includes('CoinGecko')) sources.push('CoinGecko');
if (marketContext.includes('unavailable')) {} // skip unavailable sources
sources.push('Claude Sonnet 4.6');

console.log('Sources:', sources);
res.json({ reply, sources });

  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/signal', async (req, res) => {
  try {
    const marketContext = await buildMarketContext();

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: `You are OvoWorks Signal Engine. Analyse live market data and generate a trading signal.
You MUST respond with ONLY valid JSON in this exact format, no other text:
{
  "direction": "BUY" or "SELL" or "HOLD",
  "confidence": number between 50-95,
  "price": current BTC price as number,
  "etfFlow": today's net ETF flow in millions as number (positive or negative),
  "reasoning": "one sentence explanation under 20 words"
}`,
        messages: [{
          role: 'user',
          content: `${marketContext}\n\nGenerate a BTC trade signal based on this live data. Respond with JSON only.`
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    const text = response.data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const signal = JSON.parse(clean);

    // Save to signal history
    signalHistory.unshift({
      ...signal,
      time: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString()
    });

    // Keep last 50 signals
    if (signalHistory.length > 50) signalHistory.pop();

    res.json({ signal });

  } catch (err) {
    console.error('Signal error:', err.message);
    res.status(500).json({ error: 'Signal generation failed' });
  }
});

// Get signal history
app.get('/api/signal/history', (req, res) => {
  res.json({ history: signalHistory });
});

// Get trade history
app.get('/api/trade/history', (req, res) => {
  res.json({ history: tradeHistory });
});

// Save executed trade to history
app.post('/api/trade/save', (req, res) => {
  const trade = req.body;
  tradeHistory.unshift({
    ...trade,
    time: new Date().toLocaleTimeString(),
    date: new Date().toLocaleDateString()
  });
  if (tradeHistory.length > 50) tradeHistory.pop();
  res.json({ success: true });
});

app.get('/api/etf-history', async (req, res) => {
  try {
    const { btcList, ethList } = await fetchETFHistory();

    const formatList = (list) => list.map(item => ({
      date: item.date || item.time || item.day,
      inflow: parseFloat(item.netInflow || item.dailyNetInflow || 0) / 1e6
    }));

    res.json({
      btc: formatList(btcList),
      eth: formatList(ethList)
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch ETF history' });
  }
});

// ── Spot Trade Endpoint ─────────────────────────────────────
app.post('/api/trade/spot', async (req, res) => {
  const { asset, side, usdAmount } = req.body;

  if (!process.env.WALLET_PRIVATE_KEY || !process.env.WALLET_ADDRESS) {
    return res.status(400).json({ error: 'Wallet not configured' });
  }

  const result = await placeSpotOrder({
    asset: asset || 'BTC',
    side: side === 'BUY' ? 1 : 2,
    usdAmount: parseFloat(usdAmount) || 10,
    accountID: 56942,
    privateKey: process.env.WALLET_PRIVATE_KEY
  });

  if (result.success) {
    // Save to trade history
    tradeHistory.unshift({
      ...result,
      time: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString(),
      status: 'Filled'
    });
    if (tradeHistory.length > 50) tradeHistory.pop();
  }

  res.json(result);
});

// ── Futures Trade Endpoint ──────────────────────────────────
app.post('/api/trade/futures', async (req, res) => {
  const { asset, side, usdAmount, leverage } = req.body;

  if (!process.env.WALLET_PRIVATE_KEY || !process.env.WALLET_ADDRESS) {
    return res.status(400).json({ error: 'Wallet not configured' });
  }

  const result = await placeFuturesOrder({
    asset: asset || 'BTC',
    side: side === 'LONG' ? 1 : 2,
    usdAmount: parseFloat(usdAmount) || 10,
    leverage: parseInt(leverage) || 5,
    accountID: 56942,
    privateKey: process.env.WALLET_PRIVATE_KEY
  });

  if (result.success) {
    tradeHistory.unshift({
      ...result,
      time: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString(),
      status: 'Filled'
    });
    if (tradeHistory.length > 50) tradeHistory.pop();
  }

  res.json(result);
});

// ── Wallet Balance Endpoint ─────────────────────────────────
app.get('/api/wallet/balance', async (req, res) => {
  try {
    const address = process.env.WALLET_ADDRESS;
    const [spot, futures] = await Promise.all([
      getSpotBalance(address),
      getFuturesBalance(address)
    ]);
    res.json({ spot, futures });
  } catch (e) {
    res.status(500).json({ error: 'Balance fetch failed' });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ OvoWorks running at http://0.0.0.0:${PORT}`);
  console.log(`📊 Live data: CoinGecko + SoSoValue Terminal`);
  console.log(`🤖 AI: Claude Sonnet 4.6`);
});