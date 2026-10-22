// Writes the compiled ChogPot ABI to lib/potAbi.ts so the website can use it with viem.
// Run after `npx hardhat compile`. A test checks the two never drift apart.
const fs = require("node:fs");
const path = require("node:path");

const artifact = require("../artifacts/src/ChogPot.sol/ChogPot.json");
const out = path.join(__dirname, "..", "..", "lib", "potAbi.ts");
const body =
  "// Made by contracts/scripts/export-abi.js from the compiled ChogPot contract. Do not edit by hand.\n" +
  "export const chogPotAbi = " +
  JSON.stringify(artifact.abi, null, 2) +
  " as const;\n";
fs.writeFileSync(out, body);
console.log(`Wrote ${artifact.abi.length} ABI entries to ${out}`);
