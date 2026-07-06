import { describe, it, expect } from "vitest";
import { chains } from "./chains";

describe("chains", () => {
  it("is non-empty with unique chainIds", () => {
    expect(chains.length).toBeGreaterThan(0);
    const ids = chains.map((c) => c.chainId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes exactly Ethereum, Arbitrum One, and BSC", () => {
    expect(chains.map((c) => c.chainId).sort((a, b) => a - b)).toEqual([
      1, 56, 42161,
    ]);
  });
});
