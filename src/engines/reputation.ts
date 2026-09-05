/**
 * Reputation data sources for the chain-safety engine.
 *
 * The skeleton ships an in-memory mock so the demo runs offline. Swap
 * `MockReputationProvider` for real backends later — one adapter each for:
 *   - Block explorer (contract verified? age?)          -> BscScan API
 *   - Token/contract risk                               -> GoPlus Security API
 *   - Sanctions                                         -> OFAC SDN list
 *   - Known scam / drainer addresses                    -> scam address feeds
 * The interface stays identical; only the implementation changes.
 */

export interface ContractInfo {
  verified: boolean;
  ageDays: number;
  /** e.g. "honeypot", "proxy", "known-scam"; empty = clean. */
  flags: string[];
}

export interface AddressInfo {
  sanctioned: boolean;
  knownScam: boolean;
}

export interface ReputationProvider {
  getContract(address: string): Promise<ContractInfo>;
  getAddress(address: string): Promise<AddressInfo>;
  /** Addresses the user has transacted with before (for first-seen + poisoning checks). */
  knownCounterparties(): Promise<string[]>;
}

/** Offline mock. Seed it with whatever the demo needs. */
export class MockReputationProvider implements ReputationProvider {
  constructor(
    private readonly contracts: Record<string, ContractInfo> = {},
    private readonly addresses: Record<string, AddressInfo> = {},
    private readonly counterparties: string[] = [],
  ) {}

  async getContract(a: string): Promise<ContractInfo> {
    return this.contracts[a.toLowerCase()] ?? { verified: false, ageDays: 0, flags: [] };
  }
  async getAddress(a: string): Promise<AddressInfo> {
    return this.addresses[a.toLowerCase()] ?? { sanctioned: false, knownScam: false };
  }
  async knownCounterparties(): Promise<string[]> {
    return this.counterparties.map((a) => a.toLowerCase());
  }
}
