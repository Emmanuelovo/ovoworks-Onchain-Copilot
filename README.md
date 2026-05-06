# OvoWorks — OnChain Finance Copilot

> AI copilot for live crypto intelligence, powered by SoSoValue.

![OvoWorks](https://img.shields.io/badge/Powered%20by-SoSoValue-F4845F?style=for-the-badge)
![Claude](https://img.shields.io/badge/AI-Claude%20Sonnet%204.6-black?style=for-the-badge)
![Railway](https://img.shields.io/badge/Deployed-Railway-purple?style=for-the-badge)

## 🌐 Live Demo
**[ovoworks-onchain-copilot-production.up.railway.app](https://ovoworks-onchain-copilot-production.up.railway.app)**

---

## 📖 What is OvoWorks?

OvoWorks is an AI-powered OnChain Finance Copilot that gives anyone instant, plain-English financial intelligence powered by live market data.

Ask it anything:
- *"What are institutions doing with Bitcoin right now?"*
- *"Give me a crypto market brief for today"*
- *"Should I be looking at ETH right now?"*

OvoWorks responds with real, specific, data-driven insights in seconds, powered by live SoSoValue data and Claude AI.

---

## 🧠 How It Works
User Question
↓
Fetch Live Data (SoSoValue + CoinGecko)
↓
Inject into Claude Sonnet 4.6
↓
Plain English Answer with Real Numbers

---

## 📊 Data Sources

| Source | Data |
|--------|------|
| SoSoValue Terminal API | Live BTC/ETH ETF flows, crypto news |
| CoinGecko API | Real-time prices, market cap, dominance |
| Claude Sonnet 4.6 | AI reasoning and response generation |

---

## 🏗️ Tech Stack

- **Backend:** Node.js + Express
- **AI:** Claude Sonnet 4.6 (Anthropic)
- **Data:** SoSoValue Terminal API + CoinGecko
- **Deployment:** Railway
- **Frontend:** HTML + CSS + JavaScript

---

## 🚀 Run Locally

### Prerequisites
- Node.js installed
- SoSoValue API key
- Anthropic API key

### Steps

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/ovoworks
cd ovoworks

# Install dependencies
npm install

# Create .env file
touch .env
```

Add your keys to `.env`:
ANTHROPIC_API_KEY=your-anthropic-key
SOSOVALUE_API_KEY=your-sosovalue-key
PORT=3000

```bash
# Start the server
node server.js
```

Open `http://localhost:3000` in your browser.

---

## 🗺️ Roadmap

| Wave | Focus | Status |
|------|-------|--------|
| Wave 1 | Concept, UI, AI brain, live data, deployment | ✅ Complete |
| Wave 2 | SoDEX integration, portfolio tracker, ETF charts | 🔜 May 18 |
| Wave 3 | Full polish, alerts, mobile UI, final demo | 🔜 Jun 4 |

---

## ⚠️ Disclaimer

OvoWorks provides data-driven market intelligence for informational purposes only. Nothing here constitutes financial advice. Always do your own research before making investment decisions.

---

## 🏆 Built for SoSoValue Buildathon 2026

Built on SoSoValue's one-stop infrastructure: Terminal API, SoDEX, and ValueChain as part of the SoSoValue x Akindo Buildathon 2026.

> *"Build Your One-Person On-Chain Finance Business"*
