require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

// The key and RPC come from environment variables only. Nothing secret is ever written in this folder.
// The testnet network is only added when both are set, so tests run with no setup at all.
const key = process.env.MONAD_TESTNET_PRIVATE_KEY;
const rpc = process.env.MONAD_TESTNET_RPC;

const networks = {};
if (key && rpc) {
  networks.monadTestnet = { url: rpc, chainId: 10143, accounts: [key] };
}

const mainKey = process.env.MONAD_MAINNET_PRIVATE_KEY;
const mainRpc = process.env.MONAD_MAINNET_RPC;
if (mainKey && mainRpc) {
  networks.monadMainnet = { url: mainRpc, chainId: 143, accounts: [mainKey] };
}

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks,
  paths: { sources: "./src", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};
