// Deploy ChogPot to the Monad TESTNET only (chain id 10143).
// Everything comes from environment variables. No key is ever written to a file.
//
//   MONAD_TESTNET_PRIVATE_KEY  the deployer wallet's key (becomes the owner)
//   MONAD_TESTNET_RPC          a Monad testnet RPC address
//   POT_TOKEN                  the ERC20 the pot takes (on testnet: a test token, see deploy-test-token.js)
//   POT_SETTLER                the game server's wallet address that will post winners
//   POT_MIN_ENTRY              minimum entry in whole tokens, for example 100
//
// Run: npx hardhat run scripts/deploy.js --network monadTestnet
const { ethers, network } = require("hardhat");

const TESTNET_CHAIN_ID = 10143n;

function need(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing environment variable ${name}`);
  return v.trim();
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== TESTNET_CHAIN_ID || network.name !== "monadTestnet") {
    throw new Error(`Refusing to deploy: this script is for Monad testnet (10143) only, got chain ${chainId} on "${network.name}".`);
  }

  const token = need("POT_TOKEN");
  const settler = need("POT_SETTLER");
  if (!ethers.isAddress(token)) throw new Error("POT_TOKEN is not an address");
  if (!ethers.isAddress(settler)) throw new Error("POT_SETTLER is not an address");
  if ((await ethers.provider.getCode(token)) === "0x") throw new Error("POT_TOKEN has no contract on this chain");

  const erc20 = new ethers.Contract(token, ["function decimals() view returns (uint8)", "function symbol() view returns (string)"], ethers.provider);
  const decimals = await erc20.decimals();
  const symbol = await erc20.symbol();
  const minEntry = ethers.parseUnits(need("POT_MIN_ENTRY"), decimals);
  if (minEntry === 0n) throw new Error("POT_MIN_ENTRY must be more than 0");

  const [deployer] = await ethers.getSigners();
  if (deployer.address.toLowerCase() === settler.toLowerCase()) {
    console.warn("Warning: the owner and the settler are the same wallet. Safer to keep them apart.");
  }
  console.log(`Deployer (owner): ${deployer.address}`);
  console.log(`Token: ${token} (${symbol}, ${decimals} decimals)`);
  console.log(`Settler: ${settler}`);
  console.log(`Min entry: ${need("POT_MIN_ENTRY")} ${symbol}`);

  const Pot = await ethers.getContractFactory("ChogPot");
  const pot = await Pot.deploy(token, settler, minEntry);
  await pot.waitForDeployment();
  console.log(`ChogPot deployed at ${await pot.getAddress()}`);
  console.log(`Deploy transaction: ${pot.deploymentTransaction().hash}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
