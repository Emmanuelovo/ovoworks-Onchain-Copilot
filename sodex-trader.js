process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const axios = require('axios');
const ethers = require('ethers');
const dotenv = require('dotenv');
dotenv.config();

const TESTNET = 'https://testnet-gw.sodex.dev/api/v1/spot';
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const WALLET_ADDRESS_LOWER = WALLET_ADDRESS?.toLowerCase();
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
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

async function signPayload(payloadObj, nonce) {
  const privateKey = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const wallet = new ethers.Wallet(privateKey);

  const payloadJson = JSON.stringify(payloadObj);
  console.log('📝 Signing:', payloadJson);

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

async function getBalance() {
  const res = await axios.get(
    `${TESTNET}/accounts/${WALLET_ADDRESS_LOWER}/balances`,
    { headers: { 'Accept': 'application/json' } }
  );
  const balances = res.data?.data?.balances || [];
  const usdc = balances.find(b => b.coin === 'vUSDC')?.total || '0';
  const btc = balances.find(b => b.coin === 'vBTC')?.total || '0';
  console.log(`💰 Balance — vUSDC: ${usdc} | vBTC: ${btc}`);
  return { usdc: parseFloat(usdc), btc: parseFloat(btc) };
}

async function getBTCPrice() {
  const res = await axios.get(
    `${TESTNET}/markets/tickers?symbol=vBTC_vUSDC`,
    { headers: { 'Accept': 'application/json' } }
  );
  const price = parseFloat(res.data?.data?.[0]?.lastPx || 0);
  console.log(`📊 BTC Price: $${price}`);
  return price;
}

async function placeOrder(side, quantity) {
  try {
    console.log(`\n🤖 Placing ${side === 1 ? 'BUY' : 'SELL'} order...`);

    const nonce = Date.now();
    const clOrdID = `ovo-${nonce}`;

    // EXACT Spot BatchNewOrderRequest schema from docs
    // No modifier, reduceOnly, positionSide — those are Perps only!
    const params = {
      accountID: 56942,
      orders: [{
        symbolID: 1,
        clOrdID: clOrdID,
        side: side,
        type: 2,
        timeInForce: 3,
        quantity: String(parseFloat(quantity).toFixed(5))
      }]
    };

    const signingPayload = {
      type: 'batchNewOrder',
      params: params
    };

    const typedSig = await signPayload(signingPayload, nonce);
    console.log('✅ Signature generated');

    console.log('📤 Request body:', JSON.stringify(params));
console.log('📝 Signed params:', JSON.stringify(signingPayload.params));
console.log('✅ Match:', JSON.stringify(params) === JSON.stringify(signingPayload.params));

    const headers = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-API-Sign': typedSig,
  'X-API-Nonce': nonce.toString(),
  'X-API-Chain': CHAIN_ID.toString()
};

const res = await axios.post(
  `${TESTNET}/trade/orders/batch`,
  params,
  { headers }
);

    console.log('✅ Order response:');
    console.log(JSON.stringify(res.data, null, 2));
    return res.data;

  } catch (err) {
    console.error('❌ Order error:', err.response?.data || err.message);
  }
}

async function runTest() {
  console.log('🚀 OvoWorks Auto-Trader — Testnet Mode');
  console.log('=====================================');
  await getBalance();
  const price = await getBTCPrice();
  const testQuantity = (10 / price).toFixed(5);
  console.log(`\n🧪 Test buy: $10 worth = ${testQuantity} vBTC`);
  await placeOrder(1, testQuantity);
}

runTest();