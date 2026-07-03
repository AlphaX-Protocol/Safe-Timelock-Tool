import { describe, it, expect, vi } from "vitest";
import { buildExplorerUrl, fetchAbi } from "./explorer";

const ADDR = "0x0000000000000000000000000000000000000009";

describe("buildExplorerUrl", () => {
  it("targets the v2 multichain endpoint with chainid", () => {
    const url = buildExplorerUrl(42161, ADDR, "KEY");
    expect(url).toContain("https://api.etherscan.io/v2/api");
    expect(url).toContain("chainid=42161");
    expect(url).toContain(`address=${ADDR}`);
    expect(url).toContain("apikey=KEY");
    expect(url).toContain("action=getabi");
  });
});

describe("fetchAbi", () => {
  it("requires an API key", async () => {
    const res = await fetchAbi(1, ADDR, "   ");
    expect(res.ok).toBe(false);
  });

  it("rejects an invalid address before fetching", async () => {
    const spy = vi.fn();
    const res = await fetchAbi(1, "0x123", "KEY", spy as never);
    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the ABI on status 1", async () => {
    const mock = vi.fn().mockResolvedValue({
      json: async () => ({ status: "1", result: "[]" }),
    });
    const res = await fetchAbi(1, ADDR, "KEY", mock as never);
    expect(res).toEqual({ ok: true, abi: "[]" });
  });

  it("surfaces the explorer error on status 0", async () => {
    const mock = vi.fn().mockResolvedValue({
      json: async () => ({ status: "0", result: "Contract source code not verified" }),
    });
    const res = await fetchAbi(1, ADDR, "KEY", mock as never);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("not verified");
    }
  });

  it("handles network errors", async () => {
    const mock = vi.fn().mockRejectedValue(new Error("boom"));
    const res = await fetchAbi(1, ADDR, "KEY", mock as never);
    expect(res.ok).toBe(false);
  });
});
