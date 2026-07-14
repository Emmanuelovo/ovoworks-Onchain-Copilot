process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const axios = require('axios');
const ethers = require('ethers');

const TESTNET = 'https://testnet-gw.sodex.dev/api/v1/spot';
const CHAIN_ID = 138565;

function normalizeEthersSigToSodexWire(sig65) {
  const sig = ethers.Signature.from(sig65);
  const v = typeof sig.yParity === 'number'
    ? sig.yParity
    : sig.v >= 27 ? sig.v - 27 : sig.v;
  return ethers.hexlify(
    ethers.concat([
      new Uint8Array([1]),
      ethers.getBytes(sig.r),
      ethers.getBytes(sig.s),
      new Uint8Array([v])
    ])
  );
}

async function signPayload(payloadObj, nonce, privateKey) {
  const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const wallet = new ethers.Wallet(pk);
  const payloadJson = JSON.stringify(payloadObj);
  const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payloadJson));
  const domain = {
    name: 'spot',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: '0x0000000000000000000000000000000000000000'
  };
  const types = {
    ExchangeAction: [
      { name: 'payloadHash', type: 'bytes32' },
      { name: 'nonce', type: 'uint64' }
    ]
  };
  const sig65 = await wallet.signTypedData(domain, types, { payloadHash, nonce });
  return normalizeEthersSigToSodexWire(sig65);
}

async function getSpotBalance(walletAddress) {
  const res = await axios.get(
    `${TESTNET}/accounts/${walletAddress.toLowerCase()}/balances`,
    { headers: { 'Accept': 'application/json' } }
  );
  const balances = res.data?.data?.balances || [];
  const usdc = balances.find(b => b.coin === 'vUSDC')?.total || '0';
  const btc = balances.find(b => b.coin === 'vBTC')?.total || '0';
  const eth = balances.find(b => b.coin === 'vETH')?.total || '0';
  return {
    usdc: parseFloat(usdc),
    btc: parseFloat(btc),
    eth: parseFloat(eth)
  };
}

async function getSpotPrice(symbol = 'vBTC_vUSDC') {
  const res = await axios.get(
    `${TESTNET}/markets/tickers?symbol=${symbol}`,
    { headers: { 'Accept': 'application/json' } }
  );
  return parseFloat(res.data?.data?.[0]?.lastPx || 0);
}

// symbol map
const SYMBOL_MAP = {
  'BTC':  { symbolID: 1,  ticker: 'vBTC_vUSDC',  precision: 5 },
  'ETH':  { symbolID: 2,  ticker: 'vETH_vUSDC',  precision: 4 },
  'SOL':  { symbolID: 6,  ticker: 'vSOL_vUSDC',  precision: 3 },
  'BNB':  { symbolID: 9,  ticker: 'vBNB_vUSDC',  precision: 3 },
  'XRP':  { symbolID: 8,  ticker: 'vXRP_vUSDC',  precision: 1 },
  'DOGE': { symbolID: 7,  ticker: 'vDOGE_vUSDC', precision: 0 },
  'ADA':  { symbolID: 10, ticker: 'vADA_vUSDC',  precision: 1 },
  'SOL':  { symbolID: 6,  ticker: 'vSOL_vUSDC',  precision: 3 },
  'LINK': { symbolID: 5,  ticker: 'vLINK_vUSDC', precision: 1 },
};
async function placeSpotOrder({ asset = 'BTC', side, usdAmount, accountID, privateKey }) {
  try {
    const symbolInfo = SYMBOL_MAP[asset.toUpperCase()];
    if (!symbolInfo) throw new Error(`Asset ${asset} not supported`);

    // Get current price
    const price = await getSpotPrice(symbolInfo.ticker);
    const quantity = (usdAmount / price).toFixed(symbolInfo.precision);

    console.log(`🤖 SPOT ${side === 1 ? 'BUY' : 'SELL'} ${asset} — $${usdAmount} = ${quantity} ${asset} @ $${price}`);

    const nonce = Date.now();
    const clOrdID = `ovo-spot-${nonce}`;

    const params = {
      accountID: Number(accountID),
      orders: [{
        symbolID: symbolInfo.symbolID,
        clOrdID,
        side,        // 1 = BUY, 2 = SELL
        type: 2,     // MARKET
        timeInForce: 3, // IOC
        quantity: String(quantity)
      }]
    };

    const signingPayload = { type: 'batchNewOrder', params };
    const typedSig = await signPayload(signingPayload, nonce, privateKey);

    const res = await axios.post(
      `${TESTNET}/trade/orders/batch`,
      params,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-API-Sign': typedSig,
          'X-API-Nonce': nonce.toString(),
          'X-API-Chain': CHAIN_ID.toString()
        }
      }
    );

    const result = res.data?.data?.[0];
    if (result?.code === 0) {
      return {
        success: true,
        type: 'SPOT',
        asset,
        side: side === 1 ? 'BUY' : 'SELL',
        quantity,
        price,
        usdAmount,
        orderID: result.orderID,
        clOrdID: result.clOrdID
      };
    } else {
      return { success: false, error: result?.msg || 'Order failed' };
    }

  } catch (err) {
    return { success: false, error: err.response?.data?.error || err.message };
  }
}

module.exports = { placeSpotOrder, getSpotBalance, getSpotPrice, SYMBOL_MAP };