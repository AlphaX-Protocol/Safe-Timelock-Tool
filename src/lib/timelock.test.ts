import { describe, it, expect } from "vitest";
import {
  ZERO_HASH,
  encodeSchedule,
  encodeExecute,
  decodeTimelock,
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
});
