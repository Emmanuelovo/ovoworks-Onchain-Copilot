process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const axios = require('axios');
const ethers = require('ethers');

const TESTNET_PERPS = 'https://testnet-gw.sodex.dev/api/v1/perps';
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
    name: 'futures',
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

async function getFuturesBalance(walletAddress) {
  try {
    const res = await axios.get(
      `${TESTNET_PERPS}/accounts/${walletAddress.toLowerCase()}/state`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = res.data?.data;
    return {
      equity: parseFloat(data?.equity || 0),
      availableMargin: parseFloat(data?.availableMargin || 0),
      unrealizedPnl: parseFloat(data?.unrealizedPnl || 0)
    };
  } catch (e) {
    return { equity: 0, availableMargin: 0, unrealizedPnl: 0 };
  }
}

const PERPS_SYMBOL_MAP = {
  'BTC': { symbolID: 1, precision: 5, maxLeverage: 25 },
  'ETH': { symbolID: 2, precision: 4, maxLeverage: 20 },
  'SOL': { symbolID: 4, precision: 3, maxLeverage: 20 },
  'DOGE': { symbolID: 5, precision: 0, maxLeverage: 10 },
};

async function getPerpsAccountID(walletAddress) {
  try {
    const res = await axios.get(
      `${TESTNET_PERPS}/accounts/${walletAddress.toLowerCase()}/state`,
      { headers: { 'Accept': 'application/json' } }
    );
    const aid = res.data?.data?.aid;
    console.log('Perps Account ID:', aid);
    return aid;
  } catch (e) {
    console.error('Perps account error:', e.message);
    return null;
  }
}

async function placeFuturesOrder({
  asset = 'BTC',
  side,
  usdAmount,
  leverage = 5,
  accountID,
  privateKey
}) {
  try {
    const symbolInfo = PERPS_SYMBOL_MAP[asset.toUpperCase()];
    if (!symbolInfo) throw new Error(`Asset ${asset} not supported for futures`);

    const priceRes = await axios.get(
      `${TESTNET_PERPS}/markets/tickers?symbol=${asset}-USD`,
      { headers: { 'Accept': 'application/json' } }
    );
    const price = parseFloat(priceRes.data?.data?.[0]?.lastPx || 0);
    const notional = usdAmount * leverage;
    const quantity = (notional / price).toFixed(symbolInfo.precision);

    console.log(`🤖 FUTURES ${side === 1 ? 'LONG' : 'SHORT'} ${asset} — $${usdAmount} x ${leverage}x leverage`);

    const nonce = Date.now();
    const clOrdID = `ovo-perps-${nonce}`;

    const perpsAID = await getPerpsAccountID(process.env.WALLET_ADDRESS);
const params = {
  accountID: Number(perpsAID || accountID),
      symbolID: symbolInfo.symbolID,
      orders: [{
        clOrdID,
        modifier: 1,
        side,
        type: 2,
        timeInForce: 3,
        quantity: String(quantity),
        reduceOnly: false,
        positionSide: 1
      }]
    };

    const signingPayload = { type: 'newOrder', params };
    const typedSig = await signPayload(signingPayload, nonce, privateKey);

    const res = await axios.post(
      `${TESTNET_PERPS}/trade/orders`,
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

    const result = res.data?.data?.[0] || res.data?.data;
const code = res.data?.code;
if (code === 0) {
  return {
    success: true,
    type: 'FUTURES',
    asset,
    side: side === 1 ? 'LONG' : 'SHORT',
    quantity,
    price,
    usdAmount,
    leverage,
    notional,
    orderID: result?.orderID,
    clOrdID: result?.clOrdID
  };
} else {
  return {
    success: false,
    error: res.data?.error || result?.msg || 'Futures order failed'
  };
}

  } catch (err) {
    return { success: false, error: err.response?.data?.error || err.message };
  }
}

module.exports = { placeFuturesOrder, getFuturesBalance, PERPS_SYMBOL_MAP };