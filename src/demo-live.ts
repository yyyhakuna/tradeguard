/**
 * Live reputation demo — exercises the REAL data sources (OFAC + GoPlus + BscScan).
 *
 * Unlike `npm run demo` (fully offline), this one makes network calls:
 *   - OFAC + GoPlus need no API key.
 *   - Contract verification/age needs a BscScan/Etherscan key: set BSCSCAN_KEY.
 *
 * Run:  BSCSCAN_KEY=xxxx npm run demo:live
 *       (without the key it still runs the sanctions/scam address checks)
 */
import { LiveReputationProvider } from "./index.ts";

// A currently-listed OFAC SDN crypto address. Should come back sanctioned.
// (The list is live — if delisted upstream, swap for any entry from ofacListUrl.)
const SANCTIONED = "0x0330070fd38ec3bb94f58fa55d40368271e9e54a";
// Vitalik's public address — not sanctioned, not scam.
const CLEAN = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
// Verified USDT (BSC-USD) token contract on BNB Smart Chain.
const VERIFIED_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";

async function run() {
  console.log("=== TradeGuard live reputation demo ===\n");

  const apiKey = process.env.BSCSCAN_KEY ?? "";
  const rep = new LiveReputationProvider({
    explorerApiKey: apiKey || "no-key-address-checks-only",
  });

  console.log("[OFAC + GoPlus] address checks (no key needed)");
  for (const [label, addr] of [
    ["sanctioned sample", SANCTIONED],
    ["clean sample     ", CLEAN],
  ] as const) {
    const info = await rep.getAddress(addr);
    console.log(`    ${label}  ${addr}`);
    console.log(`      -> sanctioned=${info.sanctioned}  knownScam=${info.knownScam}`);
  }
  console.log();

  if (!apiKey) {
    console.log("[BscScan] skipped — set BSCSCAN_KEY to check contract verification + flags.");
    return;
  }

  console.log("[BscScan + GoPlus] contract check");
  const c = await rep.getContract(VERIFIED_CONTRACT);
  console.log(`    ${VERIFIED_CONTRACT}`);
  console.log(`      -> verified=${c.verified}  ageDays=${c.ageDays}  flags=[${c.flags.join(", ")}]`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
