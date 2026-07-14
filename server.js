const dotenv = require('dotenv');
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

// Connect to MongoDB
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => {
      console.error('❌ MongoDB error:', err.message);
      console.log('⚠️ Running without persistence — in-memory only');
    });
} else {
  console.log('⚠️ No MongoDB URI — running without persistence');
}
// Schemas
const SignalSchema = new mongoose.Schema({
  direction: String,
  confidence: Number,
  price: Number,
  etfFlow: Number,
  reasoning: String,
  time: String,
  date: String,
  createdAt: { type: Date, default: Date.now }
});

const TradeSchema = new mongoose.Schema({
  type: String,
  asset: String,
  side: String,
  quantity: String,
  price: Number,
  usdAmount: Number,
  leverage: Number,
  orderID: Number,
  status: String,
  time: String,
  date: String,
  createdAt: { type: Date, default: Date.now }
});

const ChatSchema = new mongoose.Schema({
  sessionId: String,
  role: String,
  content: String,
  createdAt: { type: Date, default: Date.now }
});

const Signal = mongoose.model('Signal', SignalSchema);
const Trade = mongoose.model('Trade', TradeSchema);
const Chat = mongoose.model('Chat', ChatSchema);

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
  try {
    const btcTickers = ['ibit', 'fbtc', 'bitb'];
    const ethTickers = ['etha', 'feth'];

    const btcRequests = btcTickers.map(ticker =>
      axios.get(
        `https://openapi.sosovalue.com/api/v1/etfs/${ticker}/history?pageNum=1&pageSize=14`,
        {
          headers: {
            'x-soso-api-key': process.env.SOSOVALUE_API_KEY,
            'Accept': 'application/json'
          }
        }
      ).catch(e => ({ data: null }))
    );

    const ethRequests = ethTickers.map(ticker =>
      axios.get(
        `https://openapi.sosovalue.com/api/v1/etfs/${ticker}/history?pageNum=1&pageSize=14`,
        {
          headers: {
            'x-soso-api-key': process.env.SOSOVALUE_API_KEY,
            'Accept': 'application/json'
          }
        }
      ).catch(e => ({ data: null }))
    );

    const [btcResults, ethResults] = await Promise.all([
      Promise.all(btcRequests),
      Promise.all(ethRequests)
    ]);

    // Aggregate daily net inflows across all BTC ETFs
    const btcAggregated = {};
    btcResults.forEach(res => {
      const list = res.data?.data || [];
      list.forEach(item => {
        const date = item.date || item.trade_date || item.tradingDay;
        const inflow = parseFloat(item.net_inflow || item.netInflow || item.net_flow || 0);
        if (date) {
          btcAggregated[date] = (btcAggregated[date] || 0) + inflow;
        }
      });
    });

    // Aggregate daily net inflows across all ETH ETFs
    const ethAggregated = {};
    ethResults.forEach(res => {
      const list = res.data?.data || [];
      list.forEach(item => {
        const date = item.date || item.trade_date || item.tradingDay;
        const inflow = parseFloat(item.net_inflow || item.netInflow || item.net_flow || 0);
        if (date) {
          ethAggregated[date] = (ethAggregated[date] || 0) + inflow;
        }
      });
    });

    const btcList = Object.entries(btcAggregated)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, inflow]) => ({ date, netInflow: inflow }));

    const ethList = Object.entries(ethAggregated)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, inflow]) => ({ date, netInflow: inflow }));

    console.log('✅ ETF history loaded — BTC days:', btcList.length, 'ETH days:', ethList.length);
    return { btcList, ethList };

  } catch (e) {
    console.error('ETF history error:', e.message);
    return { btcList: [], ethList: [] };
  }
}
// ── ETF Flow Backtest Engine ────────────────────────────────
async function runETFBacktest(days = 30, threshold = 100) {
  try {
    // Fetch historical ETF data for multiple tickers
    const tickers = ['ibit', 'fbtc', 'bitb'];
    const requests = tickers.map(ticker =>
      axios.get(
        `https://openapi.sosovalue.com/api/v1/etfs/${ticker}/history?pageNum=1&pageSize=${days + 5}`,
        { headers: { 'x-soso-api-key': process.env.SOSOVALUE_API_KEY, 'Accept': 'application/json' } }
      ).catch(() => ({ data: null }))
    );

    const results = await Promise.all(requests);

    // Aggregate daily flows
    const flowByDate = {};
    results.forEach(res => {
      const list = res.data?.data || [];
      list.forEach(item => {
        const date = item.date;
        const flow = parseFloat(item.net_inflow || 0);
        if (date) flowByDate[date] = (flowByDate[date] || 0) + flow;
      });
    });

    // Get historical BTC prices from CoinGecko
    const priceRes = await axios.get(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`,
      { timeout: 10000 }
    ).catch(() => ({ data: null }));

    const prices = priceRes.data?.prices || [];
    const priceByDate = {};
    prices.forEach(([timestamp, price]) => {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      priceByDate[date] = price;
    });

    // Sort dates
    const sortedDates = Object.keys(flowByDate).sort();
    const thresholdM = threshold * 1e6;

    // Run backtest
    let trades = [];
    let position = null;
    let portfolioValue = 100; // start with $100
    let cash = 100;
    let btcHeld = 0;
    let portfolioHistory = [];

    sortedDates.forEach((date, i) => {
      const flow = flowByDate[date];
      const price = priceByDate[date] || priceByDate[Object.keys(priceByDate).find(d => d >= date)];
      if (!price) return;

      // Strategy: Buy when flow > threshold, Sell when flow < -threshold
      if (flow > thresholdM && position !== 'LONG' && cash > 0) {
        btcHeld = cash / price;
        cash = 0;
        position = 'LONG';
        trades.push({ date, action: 'BUY', price: price.toFixed(0), flow: (flow/1e6).toFixed(0), reason: `Inflow +$${(flow/1e6).toFixed(0)}M > threshold` });
      } else if (flow < -thresholdM && position === 'LONG' && btcHeld > 0) {
        cash = btcHeld * price;
        btcHeld = 0;
        position = null;
        trades.push({ date, action: 'SELL', price: price.toFixed(0), flow: (flow/1e6).toFixed(0), reason: `Outflow -$${Math.abs(flow/1e6).toFixed(0)}M < threshold` });
      }

      // Calculate portfolio value
      portfolioValue = cash + (btcHeld * price);
      portfolioHistory.push({
        date,
        value: portfolioValue.toFixed(2),
        flow: (flow/1e6).toFixed(0),
        price: price.toFixed(0),
        position: position || 'CASH'
      });
    });

    // Calculate stats
    const finalValue = portfolioValue;
    const totalReturn = ((finalValue - 100) / 100 * 100).toFixed(2);
    const winTrades = trades.filter((t, i) => {
      if (t.action !== 'SELL') return false;
      const buyTrade = trades.slice(0, i).reverse().find(bt => bt.action === 'BUY');
      return buyTrade && parseFloat(t.price) > parseFloat(buyTrade.price);
    }).length;
    const totalSells = trades.filter(t => t.action === 'SELL').length;
    const winRate = totalSells > 0 ? ((winTrades / totalSells) * 100).toFixed(0) : 'N/A';

    // BTC buy and hold comparison
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const firstPrice = priceByDate[firstDate] || 0;
    const lastPrice = priceByDate[lastDate] || 0;
    const btcReturn = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2) : 'N/A';

    return {
      summary: {
        days,
        threshold,
        totalReturn,
        finalValue: finalValue.toFixed(2),
        totalTrades: trades.length,
        winRate,
        btcBuyHoldReturn: btcReturn,
        startDate: firstDate,
        endDate: lastDate
      },
      trades: trades.slice(-20),
      portfolioHistory: portfolioHistory.slice(-days)
    };

  } catch(e) {
    console.error('Backtest error:', e.message);
    return null;
  }
}

// Backtest endpoint
app.get('/api/backtest', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const threshold = parseInt(req.query.threshold) || 100;
    const result = await runETFBacktest(days, threshold);
    if (!result) return res.status(500).json({ error: 'Backtest failed' });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Agentic Monitor Loop ────────────────────────────────────
let agentStatus = {
  running: false,
  lastCheck: null,
  lastSignal: null,
  alerts: [],
  checkCount: 0
};

async function runAgentLoop() {
  if (agentStatus.running) return;
  agentStatus.running = true;
  console.log('🤖 Agentic monitor loop started');

  const check = async () => {
    try {
      agentStatus.checkCount++;
      agentStatus.lastCheck = new Date().toISOString();
      console.log(`🤖 Agent check #${agentStatus.checkCount}`);

      const signal = await generateRuleBasedSignal();
      if (!signal) return;

      agentStatus.lastSignal = signal;

      // Alert conditions
      if (signal.signal === 'STRONG BUY' || signal.signal === 'STRONG SELL') {
        const alert = {
          time: new Date().toLocaleTimeString(),
          date: new Date().toLocaleDateString(),
          signal: signal.signal,
          confidence: signal.confidence,
          btcPrice: signal.btcPrice,
          btcFlow: (signal.btcDailyFlow / 1e6).toFixed(0),
          message: `${signal.signal} signal detected — BTC ETF flow ${signal.btcDailyFlow > 0 ? '+' : ''}$${(signal.btcDailyFlow/1e6).toFixed(0)}M, confidence ${signal.confidence}%`
        };
        agentStatus.alerts.unshift(alert);
        if (agentStatus.alerts.length > 20) agentStatus.alerts.pop();
        console.log(`🚨 AGENT ALERT: ${alert.message}`);
      }

    } catch(e) {
      console.error('Agent loop error:', e.message);
    }
  };

  // Run immediately then every 30 minutes
  await check();
  setInterval(check, 30 * 60 * 1000);
}

// Agent status endpoint
app.get('/api/agent/status', (req, res) => {
  res.json(agentStatus);
});

// Start agent loop
runAgentLoop();

// ── Rule-Based Signal Engine ────────────────────────────────
async function generateRuleBasedSignal() {
  try {
    // Fetch all data in parallel
    const [btcETF, ethETF, prices, news] = await Promise.all([
      axios.post(
        'https://api.sosovalue.xyz/openapi/v2/etf/currentEtfDataMetrics',
        { type: 'us-btc-spot' },
        { headers: { 'x-soso-api-key': process.env.SOSOVALUE_API_KEY, 'Content-Type': 'application/json' } }
      ).catch(() => ({ data: null })),
      axios.post(
        'https://api.sosovalue.xyz/openapi/v2/etf/currentEtfDataMetrics',
        { type: 'us-eth-spot' },
        { headers: { 'x-soso-api-key': process.env.SOSOVALUE_API_KEY, 'Content-Type': 'application/json' } }
      ).catch(() => ({ data: null })),
      axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true',
        { timeout: 8000 }
      ).catch(() => ({ data: {} })),
      fetchNews()
    ]);

    const btcData = btcETF.data?.data;
    const ethData = ethETF.data?.data;
    const btcPrice = prices.data?.bitcoin?.usd || 0;
    const btcChange = prices.data?.bitcoin?.usd_24h_change || 0;
    const ethPrice = prices.data?.ethereum?.usd || 0;
    const ethChange = prices.data?.ethereum?.usd_24h_change || 0;

    // ── Rule Engine ──────────────────────────────────────────
    const rules = [];
    let bullScore = 0;
    let bearScore = 0;

    // Rule 1: BTC ETF daily inflow
    const btcDailyFlow = parseFloat(btcData?.dailyNetInflow?.value || 0);
    if (btcDailyFlow > 300e6) {
      bullScore += 3;
      rules.push({ rule: 'BTC ETF Inflow > $300M', signal: 'BULL', weight: 3, value: `+$${(btcDailyFlow/1e6).toFixed(0)}M` });
    } else if (btcDailyFlow > 100e6) {
      bullScore += 1;
      rules.push({ rule: 'BTC ETF Inflow > $100M', signal: 'BULL', weight: 1, value: `+$${(btcDailyFlow/1e6).toFixed(0)}M` });
    } else if (btcDailyFlow < -300e6) {
      bearScore += 3;
      rules.push({ rule: 'BTC ETF Outflow > $300M', signal: 'BEAR', weight: 3, value: `-$${Math.abs(btcDailyFlow/1e6).toFixed(0)}M` });
    } else if (btcDailyFlow < -100e6) {
      bearScore += 1;
      rules.push({ rule: 'BTC ETF Outflow > $100M', signal: 'BEAR', weight: 1, value: `-$${Math.abs(btcDailyFlow/1e6).toFixed(0)}M` });
    } else {
      rules.push({ rule: 'BTC ETF Flow Neutral', signal: 'NEUTRAL', weight: 0, value: `$${(btcDailyFlow/1e6).toFixed(0)}M` });
    }

    // Rule 2: BTC 24h price change
    if (btcChange > 3) {
      bullScore += 2;
      rules.push({ rule: 'BTC 24h Change > +3%', signal: 'BULL', weight: 2, value: `+${btcChange.toFixed(2)}%` });
    } else if (btcChange > 1) {
      bullScore += 1;
      rules.push({ rule: 'BTC 24h Change > +1%', signal: 'BULL', weight: 1, value: `+${btcChange.toFixed(2)}%` });
    } else if (btcChange < -3) {
      bearScore += 2;
      rules.push({ rule: 'BTC 24h Change < -3%', signal: 'BEAR', weight: 2, value: `${btcChange.toFixed(2)}%` });
    } else if (btcChange < -1) {
      bearScore += 1;
      rules.push({ rule: 'BTC 24h Change < -1%', signal: 'BEAR', weight: 1, value: `${btcChange.toFixed(2)}%` });
    } else {
      rules.push({ rule: 'BTC 24h Change Neutral', signal: 'NEUTRAL', weight: 0, value: `${btcChange.toFixed(2)}%` });
    }

    // Rule 3: ETH ETF daily inflow
    const ethDailyFlow = parseFloat(ethData?.dailyNetInflow?.value || 0);
    if (ethDailyFlow > 50e6) {
      bullScore += 1;
      rules.push({ rule: 'ETH ETF Inflow > $50M', signal: 'BULL', weight: 1, value: `+$${(ethDailyFlow/1e6).toFixed(0)}M` });
    } else if (ethDailyFlow < -50e6) {
      bearScore += 1;
      rules.push({ rule: 'ETH ETF Outflow > $50M', signal: 'BEAR', weight: 1, value: `-$${Math.abs(ethDailyFlow/1e6).toFixed(0)}M` });
    }

    // Rule 4: BTC vs ETH momentum
    if (btcChange > 0 && ethChange > 0 && ethChange > btcChange) {
      bullScore += 1;
      rules.push({ rule: 'ETH outperforming BTC (risk-on)', signal: 'BULL', weight: 1, value: `ETH ${ethChange.toFixed(1)}% vs BTC ${btcChange.toFixed(1)}%` });
    } else if (btcChange > ethChange && btcChange > 0) {
      rules.push({ rule: 'BTC outperforming ETH (defensive)', signal: 'NEUTRAL', weight: 0, value: `BTC ${btcChange.toFixed(1)}% vs ETH ${ethChange.toFixed(1)}%` });
    }

    // ── Final Signal ─────────────────────────────────────────
    let signal, confidence;
    const totalScore = bullScore + bearScore;

    if (bullScore > bearScore + 2) {
      signal = 'STRONG BUY';
      confidence = Math.min(95, 60 + bullScore * 5);
    } else if (bullScore > bearScore) {
      signal = 'BUY';
      confidence = Math.min(85, 55 + bullScore * 4);
    } else if (bearScore > bullScore + 2) {
      signal = 'STRONG SELL';
      confidence = Math.min(95, 60 + bearScore * 5);
    } else if (bearScore > bullScore) {
      signal = 'SELL';
      confidence = Math.min(85, 55 + bearScore * 4);
    } else {
      signal = 'HOLD';
      confidence = 50;
    }

    return {
      signal,
      confidence,
      bullScore,
      bearScore,
      rules,
      btcPrice,
      btcChange,
      ethPrice,
      ethChange,
      btcDailyFlow,
      ethDailyFlow,
      timestamp: new Date().toISOString(),
      method: 'rule-based'
    };

  } catch(e) {
    console.error('Rule signal error:', e.message);
    return null;
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

    // Save to MongoDB
await Chat.create({
  sessionId: sid,
  role: latestMessage.role,
  content: latestMessage.content
}).catch(e => console.error('Chat save error:', e.message));

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

    await Chat.create({
  sessionId: sid,
  role: 'assistant',
  content: reply
}).catch(e => console.error('Chat save error:', e.message));

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

    const signalRecord = {
  ...signal,
  time: new Date().toLocaleTimeString(),
  date: new Date().toLocaleDateString()
};
signalHistory.unshift(signalRecord);
if (signalHistory.length > 50) signalHistory.pop();

// Save to MongoDB
await Signal.create(signalRecord).catch(e => console.error('Signal save error:', e.message));

    res.json({ signal });

  } catch (err) {
    console.error('Signal error:', err.message);
    res.status(500).json({ error: 'Signal generation failed' });
  }
});

// Get signal history
app.get('/api/signal/history', async (req, res) => {
  try {
    const dbSignals = await Signal.find().sort({ createdAt: -1 }).limit(50);
    res.json({ history: dbSignals.length > 0 ? dbSignals : signalHistory });
  } catch (e) {
    res.json({ history: signalHistory });
  }
});

// Get trade history
app.get('/api/trade/history', async (req, res) => {
  try {
    const dbTrades = await Trade.find().sort({ createdAt: -1 }).limit(50);
    res.json({ history: dbTrades.length > 0 ? dbTrades : tradeHistory });
  } catch (e) {
    res.json({ history: tradeHistory });
  }
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

  const formatList = (list) => list.map(d => ({
  date: d.date || '',
  inflow: parseFloat(d.net_inflow || d.netInflow || 0) / 1e6
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
  try {
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
      const tradeRecord = {
        ...result,
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        status: 'Filled'
      };
      tradeHistory.unshift(tradeRecord);
      if (tradeHistory.length > 50) tradeHistory.pop();
      await Trade.create(tradeRecord).catch(e => console.error('Trade save error:', e.message));
    }
    res.json(result);
  } catch (error) {
    console.error('Spot trade error:', error.message);
    res.status(500).json({ error: 'Trade failed. Please try again.' });
  }
});
// ── Futures Trade Endpoint ──────────────────────────────────
app.post('/api/trade/futures', async (req, res) => {
  try {
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
      const tradeRecord = {
        ...result,
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        status: 'Filled'
      };
      tradeHistory.unshift(tradeRecord);
      if (tradeHistory.length > 50) tradeHistory.pop();
      await Trade.create(tradeRecord).catch(e => console.error('Trade save error:', e.message));
    }
    res.json(result);
  } catch (error) {
    console.error('Futures trade error:', error.message);
    res.status(500).json({ error: 'Trade failed. Please try again.' });
  }
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

// ── Portfolio Endpoint ──────────────────────────────────────
app.get('/api/portfolio', async (req, res) => {
  try {
    const address = process.env.WALLET_ADDRESS;

    // Fetch spot balances
    const spotRes = await axios.get(
      `https://testnet-gw.sodex.dev/api/v1/spot/accounts/${address.toLowerCase()}/balances`,
      { headers: { 'Accept': 'application/json' } }
    );
    const balances = spotRes.data?.data?.balances || [];

    // Fetch open futures positions
    const perpsRes = await axios.get(
      `https://testnet-gw.sodex.dev/api/v1/perps/accounts/${address.toLowerCase()}/positions`,
      { headers: { 'Accept': 'application/json' } }
    ).catch(() => ({ data: null }));
    const positions = perpsRes.data?.data || [];

    // Get live prices for portfolio valuation
    const priceRes = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,ripple,dogecoin&vs_currencies=usd',
      { timeout: 8000 }
    ).catch(() => ({ data: {} }));
    const prices = priceRes.data;

    const btcPrice = prices.bitcoin?.usd || 0;
const ethPrice = prices.ethereum?.usd || 0;
const solPrice = prices.solana?.usd || 0;
const bnbPrice = prices.binancecoin?.usd || 0;
const xrpPrice = prices.ripple?.usd || 0;
const dogePrice = prices.dogecoin?.usd || 0;

const priceMap = {
  'vBTC': btcPrice, 'BTC': btcPrice,
  'vETH': ethPrice, 'ETH': ethPrice,
  'vSOL': solPrice, 'SOL': solPrice,
  'vBNB': bnbPrice, 'BNB': bnbPrice,
  'vXRP': xrpPrice, 'XRP': xrpPrice,
  'vDOGE': dogePrice, 'DOGE': dogePrice,
  'vUSDC': 1, 'USDC': 1, 'vUSDT': 1, 'USDT': 1
};

    // Calculate spot portfolio value
    const spotPortfolio = balances.map(b => {
  // Handle both vBTC and BTC style keys
  const coinKey = b.coin;
  const price = priceMap[coinKey] || priceMap[coinKey?.replace('v','')] || 1;
  const total = parseFloat(b.total || 0);
  const usdValue = total * price;
  console.log(`${coinKey}: total=${total}, price=${price}, usdValue=${usdValue}`);
  return {
    coin: b.coin,
    total: total,
    locked: parseFloat(b.locked || 0),
    available: total - parseFloat(b.locked || 0),
    price,
    usdValue: usdValue.toFixed(2)
  };
}).filter(b => b.total > 0);

    const totalSpotValue = spotPortfolio.reduce((sum, b) => sum + parseFloat(b.usdValue), 0);

    // Format futures positions
    const futuresPositions = Array.isArray(positions) ? positions
      .filter(p => parseFloat(p.size || p.quantity || 0) > 0)
      .map(p => ({
        symbol: p.symbol || p.symbolName,
        side: p.side === 1 ? 'LONG' : 'SHORT',
        size: parseFloat(p.size || p.quantity || 0),
        entryPrice: parseFloat(p.entryPrice || p.avgPrice || 0),
        markPrice: parseFloat(p.markPrice || 0),
        unrealizedPnl: parseFloat(p.unrealizedPnl || p.unrealisedPnl || 0),
        leverage: parseFloat(p.leverage || 1),
        margin: parseFloat(p.margin || p.initialMargin || 0)
      })) : [];

    const totalPnl = futuresPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

    res.json({
      spot: spotPortfolio,
      futures: futuresPositions,
      summary: {
        totalSpotValue: totalSpotValue.toFixed(2),
        totalPnl: totalPnl.toFixed(2),
        totalValue: (totalSpotValue + totalPnl).toFixed(2),
        positionCount: futuresPositions.length
      }
    });

  } catch (e) {
    console.error('Portfolio error:', e.message);
    res.status(500).json({ error: 'Portfolio fetch failed' });
  }
});

// Rule-based signal endpoint
app.get('/api/signal/rules', async (req, res) => {
  try {
    const signal = await generateRuleBasedSignal();
    if (!signal) return res.status(500).json({ error: 'Signal generation failed' });
    res.json({ signal });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ OvoWorks running at http://0.0.0.0:${PORT}`);
  console.log(`📊 Live data: CoinGecko + SoSoValue Terminal`);
  console.log(`🤖 AI: Claude Sonnet 4.6`);
});