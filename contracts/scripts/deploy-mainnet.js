// Deploy ChogPot to the Monad MAINNET (chain id 143) with the real CHOG token. Real money is
// involved once the page is on, so this script refuses anything unusual.
// Everything comes from environment variables. No key is ever written to a file.
//
//   MONAD_MAINNET_PRIVATE_KEY  the OWNER wallet's key (it deploys and becomes the owner)
//   MONAD_MAINNET_RPC          a Monad mainnet RPC address
//   POT_SETTLER                the game server's wallet address (must differ from the owner)
//   POT_MIN_ENTRY              minimum entry in whole CHOG, for example 1
//   POT_CONFIRM_MAINNET        must be exactly "yes"
//
// Run: npx hardhat run scripts/deploy-mainnet.js --network monadMainnet
const { ethers, network } = require("hardhat");

const MAINNET_CHAIN_ID = 143n;
const CHOG = "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777"; // same address as lib/chogToken.ts

function need(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing environment variable ${name}`);
  return v.trim();
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== MAINNET_CHAIN_ID || network.name !== "monadMainnet") {
    throw new Error(`Refusing to deploy: this script is for Monad mainnet (143) only, got chain ${chainId} on "${network.name}".`);
  }
  if (process.env.POT_CONFIRM_MAINNET !== "yes") throw new Error('Set POT_CONFIRM_MAINNET to "yes" to deploy to the mainnet.');

  const settler = need("POT_SETTLER");
  if (!ethers.isAddress(settler)) throw new Error("POT_SETTLER is not an address");
  const [deployer] = await ethers.getSigners();
  if (deployer.address.toLowerCase() === settler.toLowerCase()) {
    throw new Error("Refusing to deploy: the owner and the settler must be different wallets.");
  }

  if ((await ethers.provider.getCode(CHOG)) === "0x") throw new Error("The CHOG token was not found on this chain. Wrong RPC?");
  const erc20 = new ethers.Contract(CHOG, ["function decimals() view returns (uint8)", "function symbol() view returns (string)"], ethers.provider);
  const decimals = await erc20.decimals();
  const symbol = await erc20.symbol();
  if (symbol !== "CHOG" || decimals !== 18n) throw new Error(`Unexpected token: ${symbol}, ${decimals} decimals`);
  const minEntry = ethers.parseUnits(need("POT_MIN_ENTRY"), decimals);
  if (minEntry === 0n) throw new Error("POT_MIN_ENTRY must be more than 0");

  console.log(`Owner (deployer): ${deployer.address}`);
  console.log(`Token: ${CHOG} (${symbol}, ${decimals} decimals)`);
  console.log(`Settler: ${settler}`);
  console.log(`Min entry: ${need("POT_MIN_ENTRY")} ${symbol}`);

  const Pot = await ethers.getContractFactory("ChogPot");
  const pot = await Pot.deploy(CHOG, settler, minEntry);
  await pot.waitForDeployment();
  console.log(`ChogPot deployed at ${await pot.getAddress()}`);
  console.log(`Deploy transaction: ${pot.deploymentTransaction().hash}`);
  console.log("The pot page stays off until POT_ENABLED is set to true on the website.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
