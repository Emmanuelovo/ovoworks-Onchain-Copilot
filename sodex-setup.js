process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const TESTNET = 'https://testnet-gw.sodex.dev/api/v1/spot';

async function getSymbols() {
  try {
    console.log('🔍 Getting all trading symbols...');
    const res = await axios.get(
      `${TESTNET}/markets/symbols`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    // Print first symbol raw to see exact field names
    const symbols = res.data?.data || [];
    console.log('🔍 Raw first symbol:');
    console.log(JSON.stringify(symbols[0], null, 2));

    // Print all symbols
    console.log('\n📋 All symbols:');
    symbols.forEach(s => {
      console.log(JSON.stringify(s));
    });
    
  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
  }
}

getSymbols();