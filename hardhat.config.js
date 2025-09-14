require('dotenv').config();
require('ts-node/register');
require('@nomicfoundation/hardhat-toolbox');
require('./tasks/launchpad');

const { PRIVATE_KEY, SEPOLIA_RPC_URL, MAINNET_RPC_URL, ETHERSCAN_API_KEY } =
  process.env;

const mainnetCfg = {
  chainId: 1,
  url: MAINNET_RPC_URL || '',
  accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
};

module.exports = {
  solidity: {
    version: '0.8.25',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  defaultNetwork: 'sepolia',
  networks: {
    sepolia: {
      chainId: 11155111,
      url: SEPOLIA_RPC_URL || '',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    mainnet: mainnetCfg,
    ethereum: mainnetCfg,
  },
  etherscan: {
    apiKey: {
      mainnet: ETHERSCAN_API_KEY,
      sepolia: ETHERSCAN_API_KEY,
    },
  },
};
