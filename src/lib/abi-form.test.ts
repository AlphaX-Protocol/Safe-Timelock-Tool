import { describe, it, expect } from "vitest";
import { parseAbi, FieldError } from "./abi-form";

const ABI = JSON.stringify([
  { type: "function", name: "foo", stateMutability: "nonpayable",
    inputs: [{ name: "a", type: "address" }], outputs: [] },
  { type: "function", name: "pay", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "bar", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { type: "event", name: "Ev", inputs: [] },
]);

describe("parseAbi", () => {
  it("keeps only writable functions and computes sighash key", () => {
    const entries = parseAbi(ABI);
    expect(entries.map((e) => e.name).sort()).toEqual(["foo", "pay"]);
    const foo = entries.find((e) => e.name === "foo")!;
    expect(foo.key).toBe("foo(address)");
    expect(foo.inputs).toHaveLength(1);
    expect(foo.inputs[0].baseType).toBe("address");
  });

  it("throws on invalid ABI JSON", () => {
    expect(() => parseAbi("not json")).toThrow();
  });

  it("FieldError carries a path", () => {
    const e = new FieldError("a.b", "bad");
    expect(e.path).toBe("a.b");
    expect(e).toBeInstanceOf(Error);
  });
});
