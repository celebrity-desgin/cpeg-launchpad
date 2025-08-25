// hardhat.config.js  (CommonJS)
require('dotenv').config();
require('ts-node/register'); // TSの scripts/*.ts を実行するため
require('@nomicfoundation/hardhat-toolbox');
require('./tasks/launchpad');

module.exports = {
  solidity: {
    version: '0.8.25',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || '',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    ethereum: {
      url: process.env.MAINNET_RPC_URL || '',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
