# OvoWorks — OnChain Finance Copilot

> Your personal crypto hedge fund, run by an AI agent.

![Render](https://img.shields.io/badge/Deployed-Render-46E3B7?style=for-the-badge)
![Claude](https://img.shields.io/badge/AI-Claude%20Sonnet%204.6-black?style=for-the-badge)
![SoSoValue](https://img.shields.io/badge/Data-SoSoValue-F4845F?style=for-the-badge)
![SoDEX](https://img.shields.io/badge/Execution-SoDEX-blue?style=for-the-badge)
![MongoDB](https://img.shields.io/badge/DB-MongoDB%20Atlas-green?style=for-the-badge)

## 🌐 Live Links

| | Link |
|---|---|
| **Landing Page** | [ovoworks-onchain-copilot.onrender.com](https://ovoworks-onchain-copilot.onrender.com) |
| **Copilot App** | [ovoworks-onchain-copilot.onrender.com/app.html](https://ovoworks-onchain-copilot.onrender.com/app.html) |
| **GitHub** | [github.com/Emmanuelovo/ovoworks-Onchain-Copilot](https://github.com/Emmanuelovo/ovoworks-Onchain-Copilot) |
| **Verify Trades** | ValueChain Testnet Explorer — wallet `0x95Cc2629Bc698Aa2d00DbaE3d1105e2414e680fe` |

---

## 🧠 What is OvoWorks?

OvoWorks is an AI-powered OnChain Finance Copilot built on SoSoValue's infrastructure. It covers the full research-to-execution loop:

**Observe → Reason → Propose → Execute → Track**

Ask it anything in plain English. It pulls live institutional ETF flow data from SoSoValue Terminal, real-time prices from CoinGecko, and asset-specific news — then synthesises everything into actionable intelligence using Claude Sonnet 4.6. From there, you can execute real on-chain trades directly through SoDEX.

---

## ✅ Features Shipped by Wave

### Wave 1 — Concept & Early Prototype
- AI-powered chat interface with SoSoValue brand styling
- Claude Sonnet 4.6 integrated as reasoning layer
- SoSoValue Terminal API — live ETF flows + crypto news
- CoinGecko API — real-time prices + global market metrics
- Session memory — copilot remembers conversation context
- Deployed to production on Render.com

### Wave 2 — Build Phase I
- **SoDEX Spot Trading** — execute real on-chain trades across 8 assets (BTC, ETH, SOL, BNB, XRP, DOGE, ADA, LINK)
- **SoDEX Futures/Perps** — leveraged trading up to 25x with LONG/SHORT execution
- **EIP-712 Signing** — discovered correct action type `batchNewOrder` with help from SoSoValue team
- **Live Trade Signal Engine** — BUY/SELL/HOLD with confidence scoring, entry price and reasoning
- **ETF Flow Chart** — 14-day BTC/ETH institutional flow visualization
- **Portfolio Tracker** — live spot balances + open futures positions with USD valuation
- **Signal + Trade History** — persistent via MongoDB Atlas across sessions
- **Source Transparency** — every AI response tagged with data sources used
- **Currency-Specific News** — filters SoSoValue news by detected asset in user query

### Wave 3 — Build Phase II
- **Full Landing Page** — hero carousel, execution loop visualization
- **MetaMask Wallet Connect** — login/logout with wallet, balance display
- **SoDEX Faucet Integration** — direct link to claim testnet tokens
- **Rule-Based Signal Engine** — deterministic signals using ETF flow thresholds (not LLM-dependent)
- **ETF Flow Backtest Engine** — test ETF flow strategies against historical data
- **Agentic Monitor Loop** — background agent checks signals every 30 minutes, fires alerts on strong signals
- **Trader's Behavior Page** — on-chain trade history with doughnut charts (direction + type analysis)
- **Strategy Lab** — backtest interface + agent status + rule-based signals
- **SoDEX Fee Calculator** — calculates fees, breakeven %, and net profit for spot + perps
- **For Judges Guide** — step-by-step workflow from wallet connect to trade execution

---

## 🔧 Technical Challenges Solved

| Challenge | Solution |
|---|---|
| SoDEX EIP-712 signing | Action type must be `batchNewOrder` not `newOrder` — discovered via SoSoValue team support |
| SoDEX perps endpoint | `/trade/orders` not `/trade/orders/batch` for perpetuals |
| SoDEX API key header | Do not send `X-API-Key` when signing with master wallet — only send `X-API-Sign`, `X-API-Nonce`, `X-API-Chain` |
| SoSoValue ETF endpoint | `/etfs/{ticker}/history` with **lowercase** ticker — confirmed by SoSoValue tech team |
| MongoDB on Render | Added `MONGODB_URI` to Render environment variables — connects successfully |
| SSL certificates | `NODE_TLS_REJECT_UNAUTHORIZED=0` for development — proper fix for production |

---

## 📊 Data Sources

| Source | What We Use | Endpoints |
|---|---|---|
| SoSoValue Terminal | ETF flows, news, currency news, ETF history | `/news/featured`, `/etfs/{ticker}/history`, `/news/featured/currency` |
| CoinGecko | Live prices, market cap, dominance | `/simple/price`, `/global`, `/coins/bitcoin/market_chart` |
| SoDEX Spot | Trading, balances, tickers | `/trade/orders/batch`, `/accounts/{addr}/balances`, `/markets/tickers` |
| SoDEX Perps | Futures trading, positions | `/trade/orders`, `/accounts/{addr}/positions` |
| Claude Sonnet 4.6 | AI reasoning, signal generation | Anthropic Messages API |
| MongoDB Atlas | Signal + trade + chat persistence | Mongoose ODM |

---

## 🚀 Run Locally

### Prerequisites
- Node.js v18+
- MetaMask wallet
- API keys: Anthropic, SoSoValue, MongoDB URI

### Setup

```bash
# Clone
git clone https://github.com/Emmanuelovo/ovoworks-Onchain-Copilot
cd ovoworks-Onchain-Copilot

# Install
npm install

# Environment
cp .env.example .env
# Fill in your keys
```

`.env` file:
ANTHROPIC_API_KEY=sk-ant-...
SOSOVALUE_API_KEY=SOSO-...
WALLET_PRIVATE_KEY=0x...
WALLET_ADDRESS=0x...
MONGODB_URI=mongodb+srv://...
PORT=3000

```bash
# Start
node server.js
```

Open `http://localhost:3000`

---

## 🗺️ Project Structure
ovoworks-Onchain-Copilot/
├── public/
│   ├── index.html          # Landing page
│   └── app.html            # OvoWorks Copilot agent
├── traders/
│   ├── spot.js             # SoDEX spot trading module
│   └── futures.js          # SoDEX futures/perps module
├── server.js               # Express backend + all API logic
├── package.json
└── README.md

---

## ⚠️ Disclaimer

OvoWorks is built on SoDEX **testnet** — no real funds are at risk. All trades use virtual test tokens. The AI signals and analysis are for informational and demonstration purposes only. Always do your own research before making financial decisions.

---

## 🏆 Built for SoSoValue x Akindo Buildathon 2026

> *"Build Your One-Person On-Chain Finance Business with SoSoValue"*

OvoWorks demonstrates how a single developer can build institutional-grade financial intelligence and on-chain execution — powered by SoSoValue's one-stop infrastructure.

**Wallet for trade verification:** `0x95Cc2629Bc698Aa2d00DbaE3d1105e2414e680fe`