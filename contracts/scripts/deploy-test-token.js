// Optional, Monad TESTNET only: deploy a worthless "Test CHOG" token so the pot can be tried
// before real CHOG is involved. Anyone can mint it, so it must never be used with real money.
// Mints 1,000,000 to the deployer.
//
// Run: npx hardhat run scripts/deploy-test-token.js --network monadTestnet
const { ethers, network } = require("hardhat");

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 10143n || network.name !== "monadTestnet") {
    throw new Error(`Refusing: testnet only (10143), got chain ${chainId} on "${network.name}".`);
  }
  const [deployer] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("Test CHOG", "tCHOG");
  await token.waitForDeployment();
  await (await token.mint(deployer.address, ethers.parseUnits("1000000", 18))).wait();
  console.log(`Test token deployed at ${await token.getAddress()}`);
  console.log("Use that address as POT_TOKEN when you run scripts/deploy.js.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
