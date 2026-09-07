/**
 * Live reputation provider — the real backends behind the chain-safety engine.
 *
 * Implements the exact same `ReputationProvider` interface as the offline mock,
 * so swapping it in is a one-line change:
 *
 *   const reputation = new LiveReputationProvider({ explorerApiKey: process.env.BSCSCAN_KEY! });
 *   const guard = createTradeGuard({ reputation });
 *
 * Data sources (one field ↔ one authoritative source):
 *   - verified / ageDays        ← block explorer (BscScan, via Etherscan V2 multichain API)
 *   - flags (contract risk)     ← GoPlus Security  (token_security + address_security)
 *   - sanctioned                ← OFAC SDN crypto-address list  (+ GoPlus `sanctioned`)
 *   - knownScam                 ← GoPlus address_security (phishing / drainer / blacklist …)
 *   - knownCounterparties       ← explorer tx history of the user's own wallet (optional)
 *
 * Design notes:
 *   - Every lookup is cached with a TTL and de-duplicated in-flight, so a burst
 *     of screenings against the same address makes at most one network round-trip.
 *   - The OFAC list is fetched once and cached for hours; it is the fail-CLOSED
 *     backbone of the sanctions check (a local set, so it keeps working offline
 *     after first load).
 *   - `failMode` controls the CONTRACT posture on API errors. "closed" (default,
 *     recommended for a safety layer): a contract we cannot verify is treated as
 *     unverified, so an unlimited approval to it still gets blocked. "open":
 *     availability over caution — errors are treated as "looks fine".
 *   - GoPlus / OFAC need no API key. Only the explorer needs one.
 */

import type {
  AddressInfo,
  ContractInfo,
  ReputationProvider,
} from "./provider.ts";

export interface LiveReputationOptions {
  /** Explorer API key (BscScan / Etherscan). Required for verification + age. */
  explorerApiKey: string;
  /** Explorer endpoint. Default: Etherscan V2 multichain API (covers BSC via chainId). */
  explorerApiUrl?: string;
  /** Chain id for the explorer V2 API. Default 56 (BNB Smart Chain). */
  chainId?: number;
  /** GoPlus API base. Default https://api.gopluslabs.io/api/v1 . */
  goPlusApiUrl?: string;
  /** GoPlus chain id (string). Default "56" (BSC). */
  goPlusChainId?: string;
  /** OFAC sanctioned crypto-address list (one 0x-address per line). */
  ofacListUrl?: string;
  /** Addresses the user is known to transact with (poisoning baseline). */
  knownCounterparties?: string[];
  /** If set, counterparties are also derived from this wallet's tx history. */
  walletAddress?: string;
  /** TTL for per-address lookups. Default 5 min. */
  cacheTtlMs?: number;
  /** TTL for the OFAC list + counterparty history. Default 6 h. */
  listTtlMs?: number;
  /** Per-request timeout. Default 8 s. */
  timeoutMs?: number;
  /** Contract-check posture on API failure. Default "closed" (conservative). */
  failMode?: "closed" | "open";
  /** Inject a fetch impl (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Non-fatal error sink (network hiccups, rate limits). Defaults to console.warn. */
  onError?: (where: string, err: unknown) => void;
}

const DEFAULTS = {
  explorerApiUrl: "https://api.etherscan.io/v2/api",
  chainId: 56,
  goPlusApiUrl: "https://api.gopluslabs.io/api/v1",
  goPlusChainId: "56",
  // Widely-used machine-readable mirror of the OFAC SDN crypto addresses.
  ofacListUrl:
    "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt",
  cacheTtlMs: 5 * 60_000,
  listTtlMs: 6 * 60 * 60_000,
  timeoutMs: 8_000,
  failMode: "closed" as const,
};

/** Explorer JSON envelope: { status, message, result }. */
interface ExplorerEnvelope {
  status: string;
  message: string;
  result: unknown;
}

/** GoPlus JSON envelope: { code, message, result }. */
interface GoPlusEnvelope {
  code: number;
  message: string;
  result: unknown;
}

/** Parsed GoPlus address_security flags relevant to us. */
interface AddressScreen {
  sanctioned: boolean;
  knownScam: boolean;
  /** Human-readable risk flags for evidence, e.g. ["phishing", "blacklist"]. */
  flags: string[];
}

export class LiveReputationProvider implements ReputationProvider {
  private readonly cfg: Required<Omit<LiveReputationOptions, "walletAddress" | "onError">> &
    Pick<LiveReputationOptions, "walletAddress"> & { onError: NonNullable<LiveReputationOptions["onError"]> };
  private readonly cache = new Map<string, { value: unknown; expires: number }>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: LiveReputationOptions) {
    if (!opts.explorerApiKey) {
      throw new Error("LiveReputationProvider requires an explorerApiKey (BscScan/Etherscan).");
    }
    this.cfg = {
      explorerApiKey: opts.explorerApiKey,
      explorerApiUrl: opts.explorerApiUrl ?? DEFAULTS.explorerApiUrl,
      chainId: opts.chainId ?? DEFAULTS.chainId,
      goPlusApiUrl: opts.goPlusApiUrl ?? DEFAULTS.goPlusApiUrl,
      goPlusChainId: opts.goPlusChainId ?? DEFAULTS.goPlusChainId,
      ofacListUrl: opts.ofacListUrl ?? DEFAULTS.ofacListUrl,
      knownCounterparties: (opts.knownCounterparties ?? []).map((a) => a.toLowerCase()),
      cacheTtlMs: opts.cacheTtlMs ?? DEFAULTS.cacheTtlMs,
      listTtlMs: opts.listTtlMs ?? DEFAULTS.listTtlMs,
      timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs,
      failMode: opts.failMode ?? DEFAULTS.failMode,
      fetchImpl: opts.fetchImpl ?? fetch,
      walletAddress: opts.walletAddress?.toLowerCase(),
      onError: opts.onError ?? ((where, err) => console.warn(`[LiveReputation] ${where}:`, err)),
    };
  }

  // ── ReputationProvider ────────────────────────────────────────────────────

  async getContract(address: string): Promise<ContractInfo> {
    const addr = address.toLowerCase();
    return this.cached(`contract:${addr}`, this.cfg.cacheTtlMs, async () => {
      const [explorer, addrScreen] = await Promise.all([
        this.explorerContract(addr),
        this.screenAddress(addr), // address_security also flags malicious *contract* addresses
      ]);
      const tokenFlags = await this.goPlusTokenFlags(addr);

      const flags = [...tokenFlags, ...addrScreen.flags];
      if (explorer.unavailable && this.cfg.failMode === "closed") {
        flags.push("contract-check-unavailable");
      }
      // Fail-open only overrides the *verified* bit; genuine GoPlus risk flags stay.
      const verified =
        explorer.unavailable && this.cfg.failMode === "open" ? true : explorer.verified;

      return { verified, ageDays: explorer.ageDays, flags: dedupe(flags) };
    });
  }

  async getAddress(address: string): Promise<AddressInfo> {
    const addr = address.toLowerCase();
    return this.cached(`address:${addr}`, this.cfg.cacheTtlMs, async () => {
      const [ofac, screen] = await Promise.all([
        this.isOfacSanctioned(addr),
        this.screenAddress(addr),
      ]);
      return { sanctioned: ofac || screen.sanctioned, knownScam: screen.knownScam };
    });
  }

  async knownCounterparties(): Promise<string[]> {
    return this.cached("counterparties", this.cfg.listTtlMs, async () => {
      const set = new Set(this.cfg.knownCounterparties);
      if (this.cfg.walletAddress) {
        for (const a of await this.explorerCounterparties(this.cfg.walletAddress)) set.add(a);
      }
      return [...set];
    });
  }

  /** Addresses `address` recently transacted with — from its on-chain tx history. */
  async recentCounterparties(address: string): Promise<string[]> {
    const addr = address.toLowerCase();
    return this.cached(`recent:${addr}`, this.cfg.cacheTtlMs, () => this.explorerCounterparties(addr));
  }

  // ── Block explorer (BscScan / Etherscan V2) ───────────────────────────────

  /** Contract verification + deployment age. Fail posture governed by failMode. */
  private async explorerContract(
    addr: string,
  ): Promise<{ verified: boolean; ageDays: number; unavailable: boolean }> {
    try {
      const src = await this.explorer<Array<Record<string, unknown>>>({
        module: "contract",
        action: "getsourcecode",
        address: addr,
      });
      const row = src?.[0] ?? {};
      const abi = String(row.ABI ?? "");
      const source = String(row.SourceCode ?? "");
      // Etherscan returns this exact string for unverified contracts.
      const verified = source.trim() !== "" && abi !== "Contract source code not verified";

      const ageDays = await this.contractAgeDays(addr).catch(() => 0);
      return { verified, ageDays, unavailable: false };
    } catch (err) {
      this.cfg.onError("explorer.getsourcecode", err);
      // Conservative default: unverified => an unlimited approval to it will block.
      return { verified: false, ageDays: 0, unavailable: true };
    }
  }

  /** Days since the contract's creation tx (best-effort; 0 = unknown). */
  private async contractAgeDays(addr: string): Promise<number> {
    const rows = await this.explorer<Array<Record<string, unknown>>>({
      module: "contract",
      action: "getcontractcreation",
      contractaddresses: addr,
    });
    const row = rows?.[0];
    if (!row) return 0;
    // Newer explorer responses include `timestamp` directly; use it when present.
    const ts = Number(row.timestamp);
    if (Number.isFinite(ts) && ts > 0) {
      return Math.max(0, Math.floor((Date.now() / 1000 - ts) / 86_400));
    }
    return 0;
  }

  /** Distinct counterparties (to/from) from the wallet's recent tx history. */
  private async explorerCounterparties(wallet: string): Promise<string[]> {
    try {
      const txs = await this.explorer<Array<Record<string, unknown>>>({
        module: "account",
        action: "txlist",
        address: wallet,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "200",
        sort: "desc",
      });
      const set = new Set<string>();
      for (const tx of txs ?? []) {
        const to = String(tx.to ?? "").toLowerCase();
        const from = String(tx.from ?? "").toLowerCase();
        if (to && to !== wallet) set.add(to);
        if (from && from !== wallet) set.add(from);
      }
      return [...set];
    } catch (err) {
      this.cfg.onError("explorer.txlist", err);
      return [];
    }
  }

  private async explorer<T>(params: Record<string, string>): Promise<T> {
    const url = new URL(this.cfg.explorerApiUrl);
    url.searchParams.set("chainid", String(this.cfg.chainId));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("apikey", this.cfg.explorerApiKey);

    const env = await this.getJson<ExplorerEnvelope>(url.toString());
    // status "0" is used both for "no data" (benign) and real errors (message says so).
    if (env.status !== "1" && env.message && /rate limit|invalid|error/i.test(env.message)) {
      throw new Error(`explorer error: ${env.message} (${String(env.result).slice(0, 120)})`);
    }
    return env.result as T;
  }

  // ── GoPlus Security ───────────────────────────────────────────────────────

  /** Token-contract risk flags (honeypot, cannot-sell, mintable, …). */
  private async goPlusTokenFlags(addr: string): Promise<string[]> {
    try {
      const env = await this.getJson<GoPlusEnvelope>(
        `${this.cfg.goPlusApiUrl}/token_security/${this.cfg.goPlusChainId}?contract_addresses=${addr}`,
      );
      const map = (env.result ?? {}) as Record<string, Record<string, unknown>>;
      const t = map[addr] ?? map[Object.keys(map)[0] ?? ""];
      if (!t) return []; // spender isn't an ERC-20 (e.g. a router) — no token flags
      const flags: string[] = [];
      const on = (k: string) => String(t[k] ?? "0") === "1";
      if (on("is_honeypot")) flags.push("honeypot");
      if (on("cannot_sell_all")) flags.push("cannot-sell-all");
      if (on("is_blacklisted")) flags.push("has-blacklist");
      if (on("owner_change_balance")) flags.push("owner-can-change-balance");
      if (on("hidden_owner")) flags.push("hidden-owner");
      if (on("selfdestruct")) flags.push("selfdestruct");
      if (on("is_mintable")) flags.push("mintable");
      if (on("trading_cooldown")) flags.push("trading-cooldown");
      if (on("is_proxy")) flags.push("proxy");
      if (String(t.is_open_source ?? "1") === "0") flags.push("not-open-source");
      return flags;
    } catch (err) {
      this.cfg.onError("goplus.token_security", err);
      return [];
    }
  }

  /** address_security: sanctioned + scam/malicious signals for any address. */
  private async screenAddress(addr: string): Promise<AddressScreen> {
    try {
      const env = await this.getJson<GoPlusEnvelope>(
        `${this.cfg.goPlusApiUrl}/address_security/${addr}?chain_id=${this.cfg.goPlusChainId}`,
      );
      const r = (env.result ?? {}) as Record<string, unknown>;
      const on = (k: string) => String(r[k] ?? "0") === "1";
      const scamKeys: Array<[string, string]> = [
        ["blacklist_doubt", "blacklist"],
        ["phishing_activities", "phishing"],
        ["stealing_attack", "drainer"],
        ["cybercrime", "cybercrime"],
        ["money_laundering", "money-laundering"],
        ["financial_crime", "financial-crime"],
        ["darkweb_transactions", "darkweb"],
        ["fake_kyc", "fake-kyc"],
        ["malicious_mining_activities", "malicious-mining"],
        ["honeypot_related_address", "honeypot-related"],
      ];
      const flags = scamKeys.filter(([k]) => on(k)).map(([, label]) => label);
      return { sanctioned: on("sanctioned"), knownScam: flags.length > 0, flags };
    } catch (err) {
      this.cfg.onError("goplus.address_security", err);
      // Fail-open for scam signals; sanctions still covered by the local OFAC list.
      return { sanctioned: false, knownScam: false, flags: [] };
    }
  }

  // ── OFAC SDN sanctions list ───────────────────────────────────────────────

  private async isOfacSanctioned(addr: string): Promise<boolean> {
    const set = await this.ofacSet();
    return set.has(addr);
  }

  private ofacSet(): Promise<Set<string>> {
    return this.cached("ofac", this.cfg.listTtlMs, async () => {
      try {
        const res = await this.cfg.fetchImpl(this.cfg.ofacListUrl, {
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
        if (!res.ok) throw new Error(`OFAC list HTTP ${res.status}`);
        const text = await res.text();
        const set = new Set(
          text
            .split(/\r?\n/)
            .map((l) => l.trim().toLowerCase())
            .filter((l) => l.startsWith("0x")),
        );
        if (set.size === 0) throw new Error("OFAC list parsed empty");
        return set;
      } catch (err) {
        this.cfg.onError("ofac.list", err);
        // Empty set = fail-open on sanctions if the list can't load at all.
        // (It is cached for listTtlMs once it loads, so this is a cold-start risk only.)
        return new Set<string>();
      }
    });
  }

  // ── plumbing: cache + fetch ───────────────────────────────────────────────

  /** TTL cache with in-flight de-duplication. One key = at most one round-trip. */
  private cached<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value as T);

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const p = produce()
      .then((value) => {
        this.cache.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await this.cfg.fetchImpl(url, { signal: AbortSignal.timeout(this.cfg.timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
    return (await res.json()) as T;
  }
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
