import { describe, it, expect } from "vitest";
import { Interface } from "ethers";
import { parseAbi, FieldError, buildInitialValue, toEncodeArg, encodeCall, decodeToRows } from "./abi-form";

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

const A1 = "0x0000000000000000000000000000000000000001";
const A2 = "0x0000000000000000000000000000000000000002";

const validatorsAbi = JSON.stringify([
  { type: "function", name: "addValidators", stateMutability: "nonpayable", outputs: [],
    inputs: [
      { name: "validators", type: "tuple[]", components: [
        { name: "signer", type: "address" },
        { name: "power", type: "uint256" },
      ] },
      { name: "requiredPower", type: "uint256" },
    ] },
]);

const scalarAbi = (type: string) => JSON.stringify([
  { type: "function", name: "f", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "x", type }] },
]);

describe("buildInitialValue", () => {
  it("scaffolds tuples, arrays, bool, and leaves", () => {
    const entry = parseAbi(validatorsAbi)[0];
    expect(buildInitialValue(entry.inputs[0])).toEqual([]); // dynamic array
    expect(buildInitialValue(entry.inputs[1])).toBe(""); // uint256
    const boolEntry = parseAbi(scalarAbi("bool"))[0];
    expect(buildInitialValue(boolEntry.inputs[0])).toBe(false);
  });
});

describe("encodeCall round-trip", () => {
  it("encodes tuple[] + uint256 decodably", () => {
    const entry = parseAbi(validatorsAbi)[0];
    const values = [
      [
        { signer: A1, power: "10" },
        { signer: A2, power: "20" },
      ],
      "30",
    ];
    const data = encodeCall(validatorsAbi, entry, values as never);
    const decoded = new Interface(validatorsAbi).decodeFunctionData("addValidators", data);
    expect(decoded[0][0].signer).toBe(A1);
    expect(decoded[0][1].power).toBe(20n);
    expect(decoded[1]).toBe(30n);
  });

  it("treats empty dynamic bytes as 0x", () => {
    const entry = parseAbi(scalarAbi("bytes"))[0];
    const data = encodeCall(scalarAbi("bytes"), entry, [""]);
    const decoded = new Interface(scalarAbi("bytes")).decodeFunctionData("f", data);
    expect(decoded[0]).toBe("0x");
  });
});

describe("validation", () => {
  it("rejects out-of-range uint8 with a pathed FieldError", () => {
    const entry = parseAbi(scalarAbi("uint8"))[0];
    try {
      encodeCall(scalarAbi("uint8"), entry, ["256"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FieldError);
      expect((e as FieldError).path).toBe("x");
    }
  });

  it("rejects a bad address", () => {
    const entry = parseAbi(scalarAbi("address"))[0];
    expect(() => encodeCall(scalarAbi("address"), entry, ["0x123"])).toThrow(FieldError);
  });

  it("rejects a non-integer uint", () => {
    const entry = parseAbi(scalarAbi("uint256"))[0];
    expect(() => encodeCall(scalarAbi("uint256"), entry, ["1.5"])).toThrow(FieldError);
  });

  it("rejects odd-length bytes", () => {
    const entry = parseAbi(scalarAbi("bytes"))[0];
    expect(() => encodeCall(scalarAbi("bytes"), entry, ["0x123"])).toThrow(FieldError);
  });
});

describe("decodeToRows", () => {
  it("decodes tuple[] + uint256 into labeled string rows", () => {
    const entry = parseAbi(validatorsAbi)[0];
    const data = encodeCall(validatorsAbi, entry, [
      [{ signer: A1, power: "10" }],
      "30",
    ] as never);
    const rows = decodeToRows(validatorsAbi, entry, data);
    expect(rows[0].label).toBe("validators (tuple[])");
    expect(rows[1].label).toBe("requiredPower (uint256)");
    expect(rows[1].value).toBe("30");
    expect(rows[0].value).toContain(A1);
    expect(rows[0].value).toContain("10");
  });

  it("throws when calldata selector does not match the function", () => {
    const entry = parseAbi(scalarAbi("uint256"))[0];
    expect(() => decodeToRows(scalarAbi("uint256"), entry, "0xdeadbeef")).toThrow();
  });
});
