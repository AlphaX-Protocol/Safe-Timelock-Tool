import { describe, it, expect } from "vitest";
import { AbiCoder, keccak256 } from "ethers";
import {
  ZERO_HASH,
  encodeSchedule,
  encodeExecute,
  decodeTimelock,
  hashTimelockOperation,
} from "./timelock";

const TARGET = "0x0000000000000000000000000000000000000009";
const INNER = "0xabcdef";

describe("timelock", () => {
  it("ZERO_HASH is 32 zero bytes", () => {
    expect(ZERO_HASH).toBe("0x" + "0".repeat(64));
  });

  it("round-trips schedule including inner data and delay", () => {
    const data = encodeSchedule(TARGET, "0", INNER, ZERO_HASH, ZERO_HASH, "259200");
    const decoded = decodeTimelock("schedule", data);
    expect(decoded[0]).toBe(TARGET);
    expect(decoded[2]).toBe(INNER);
    expect(decoded[5]).toBe(259200n);
  });

  it("round-trips execute", () => {
    const data = encodeExecute(TARGET, "0", INNER, ZERO_HASH, ZERO_HASH);
    const decoded = decodeTimelock("execute", data);
    expect(decoded[0]).toBe(TARGET);
    expect(decoded[2]).toBe(INNER);
  });

  it("hashTimelockOperation matches OZ keccak256(abi.encode(...))", () => {
    // OZ TimelockController.hashOperation:
    //   keccak256(abi.encode(target, value, data, predecessor, salt))
    const expected = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes", "bytes32", "bytes32"],
        [TARGET, 0n, INNER, ZERO_HASH, ZERO_HASH],
      ),
    );
    expect(hashTimelockOperation(TARGET, "0", INNER, ZERO_HASH, ZERO_HASH)).toBe(
      expected,
    );
  });

  it("operation id changes with the salt (schedule and execute must match)", () => {
    const saltA = ZERO_HASH;
    const saltB =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    const idA = hashTimelockOperation(TARGET, "0", INNER, ZERO_HASH, saltA);
    const idB = hashTimelockOperation(TARGET, "0", INNER, ZERO_HASH, saltB);
    expect(idA).not.toBe(idB);
  });
});
