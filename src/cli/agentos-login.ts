/**
 * One-command Agent OS login (OAuth 2.1 + PKCE).
 *
 * Binance Agent OS supports **CIMD** (URL-based client ids), so there is NO
 * developer-portal registration. You host one small JSON document at a public
 * HTTPS URL; that URL is your client_id. This script generates that document for
 * you (`agent-os-client.json`), then runs the browser login.
 *
 * Steps:
 *   1. npm run agentos:login                → writes agent-os-client.json + prints what to do
 *   2. Host that file at an HTTPS URL (GitHub Pages / gist raw / S3 / any static host)
 *   3. Set AGENT_OS_CLIENT_METADATA_URL=<that url> in .env
 *   4. npm run agentos:login again          → opens the browser; authorize; done
 */
import { readFileSync, writeFileSync } from "node:fs";
import { FileOAuthProvider, connectAgentOsWithOAuth } from "../integrations/agent-os-auth.ts";

function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env */ }
}

const PORT = Number(process.env.AGENT_OS_PORT ?? 8976);

async function run() {
  loadEnv();
  console.log("=== TradeGuard × Agent OS — OAuth login ===\n");

  const metadataUrl = process.env.AGENT_OS_CLIENT_METADATA_URL;
  const clientId = process.env.AGENT_OS_CLIENT_ID; // rare fallback for pre-registered clients

  if (!metadataUrl && !clientId) {
    // Generate the CIMD document the user must host, using a placeholder client_id.
    const placeholder = "https://YOUR-HOST/agent-os-client.json";
    const doc = new FileOAuthProvider(".agentos-auth.json", PORT, "TradeGuard", undefined, undefined, placeholder)
      .clientMetadataDocument();
    writeFileSync("agent-os-client.json", JSON.stringify(doc, null, 2));
    console.log(
      "Binance Agent OS uses URL-based client ids (CIMD) — no portal registration.\n\n" +
        "Wrote agent-os-client.json. To finish:\n" +
        "  1. Host it at a public HTTPS URL (GitHub Pages, gist raw, S3, …).\n" +
        `  2. Edit that file so \"client_id\" equals the URL you host it at.\n` +
        "  3. In .env set:  AGENT_OS_CLIENT_METADATA_URL=<that url>\n" +
        "  4. Re-run:       npm run agentos:login\n\n" +
        `The redirect URI is already http://localhost:${PORT}/callback.\n`,
    );
    return;
  }

  console.log(
    metadataUrl
      ? `Using CIMD client id: ${metadataUrl}\n(Make sure that URL serves the JSON with "client_id" set to itself.)\n`
      : `Using pre-registered client id: ${clientId}\n`,
  );

  const os = await connectAgentOsWithOAuth({
    url: process.env.AGENT_OS_URL,
    clientMetadataUrl: metadataUrl,
    clientId,
    clientSecret: process.env.AGENT_OS_CLIENT_SECRET,
    port: PORT,
  });

  console.log(`\n✅ Connected. ${os.tools.length} Agent OS tools discovered (now guarded by TradeGuard):`);
  for (const t of os.tools) console.log(`   - ${t.name}`);
  console.log("\nToken saved to .agentos-auth.json (gitignored). Reuse via connectAgentOsWithOAuth().");
  await os.close();
}

run().catch((e) => {
  console.error("\n❌ Login failed:", e?.message ?? e);
  process.exit(1);
});
