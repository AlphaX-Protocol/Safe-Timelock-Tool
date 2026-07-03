import { describe, it, expect } from "vitest";
import { chains } from "./chains";

describe("chains", () => {
  it("is non-empty with unique chainIds", () => {
    expect(chains.length).toBeGreaterThan(0);
    const ids = chains.map((c) => c.chainId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes Ethereum mainnet and Arbitrum One", () => {
    expect(chains.some((c) => c.chainId === 1)).toBe(true);
    expect(chains.some((c) => c.chainId === 42161)).toBe(true);
  });
});
