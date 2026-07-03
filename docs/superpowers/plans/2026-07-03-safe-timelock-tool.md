# Safe Timelock Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the copied `ops/web` scaffold into a standalone, fully generic Safe multisig + OZ TimelockController calldata encode/decode tool driven by user-imported ABIs.

**Architecture:** Client-side React+TS+Vite SPA. A pure `lib/` layer (no React) does all ABI parsing, recursive form-value building, validation, encoding, decoding, timelock wrapping, and explorer fetch. A thin recursive `ParamField` component renders any ethers `ParamType`. `App.tsx` is orchestration/state only.

**Tech Stack:** React 18.3, TypeScript 5.5 (strict), Vite 5.4, ethers 6.13, Vitest (added by this plan). Node 24.

## Global Constraints

- Working directory for all paths: `/Users/yan.he/work/dex/safe-timelock-tool`.
- ethers v6 API only (`Interface`, `ParamType`, `isAddress`, `isHexString`). Never import from `ethers/lib/...` v5 paths.
- TypeScript strict mode is on, plus `noUnusedLocals` and `noUnusedParameters`. Code must compile clean.
- All `lib/` modules are pure (no React, no direct `window`/`localStorage` — the explorer takes an injectable `fetch`). React/DOM/localStorage access lives only in components.
- Tests import Vitest APIs explicitly (`import { describe, it, expect, vi } from "vitest"`) — no global test types.
- Commit after every task with the shown message. Do not modify the `asset-vault-contracts` repo.
- The original `asset-vault-contracts/ops/web` stays untouched; all work happens in this new repo.

## File Structure

- `package.json` — rename to `safe-timelock-tool`, add Vitest + test scripts. *(Task 1)*
- `tsconfig.app.json` — exclude test files from the production typecheck. *(Task 1)*
- `src/lib/abi-form.ts` — CREATE. Type-driven engine: `FieldError`, `FunctionEntry`, `FormValue`, `parseAbi`, `buildInitialValue`, `toEncodeArg`, `encodeCall`, `decodeToRows`. *(Tasks 2–4)*
- `src/lib/timelock.ts` — CREATE. OZ schedule/execute ABIs, `ZERO_HASH`, `encodeSchedule`, `encodeExecute`, `decodeTimelock`. *(Task 5)*
- `src/lib/explorer.ts` — CREATE. `buildExplorerUrl`, `fetchAbi`. *(Task 6)*
- `src/config/chains.ts` — REWRITE. Generic built-in chain list, no contract addresses. *(Task 7)*
- `src/components/ParamField.tsx` — CREATE. Recursive renderer for any `ParamType`. *(Task 8)*
- `src/App.tsx` — REWRITE. Orchestration. *(Task 8)*
- `src/config/operations.ts` — DELETE. *(Task 8)*
- `src/lib/abi.ts` — DELETE (logic ported into `abi-form.ts`). *(Task 8)*
- `index.html`, `README.md` — update title/name. *(Task 8)*

Test files: `src/lib/abi-form.test.ts`, `src/lib/timelock.test.ts`, `src/lib/explorer.test.ts`, `src/config/chains.test.ts`.

---

### Task 1: Tooling — Vitest + package metadata

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.app.json`
- Test: `src/smoke.test.ts` (temporary, deleted at end of task)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` (Vitest) command for all later tasks.

- [ ] **Step 1: Rewrite `package.json`**

```json
{
  "name": "safe-timelock-tool",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.app.json --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "ethers": "^6.13.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Exclude tests from the production typecheck**

In `tsconfig.app.json`, add an `exclude` key as a sibling of `compilerOptions` and `include`:

```json
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
```

(Append the `exclude` line after the existing `include` line; keep the closing brace.)

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: adds `vitest` to `node_modules`, exits 0.

- [ ] **Step 4: Write a temporary smoke test**

Create `src/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("tooling", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 6: Delete the smoke test**

Run: `rm src/smoke.test.ts`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.app.json
git commit -m "chore: add vitest and rename project to safe-timelock-tool"
```

---

### Task 2: `abi-form` — types + `parseAbi`

**Files:**
- Create: `src/lib/abi-form.ts`
- Test: `src/lib/abi-form.test.ts`

**Interfaces:**
- Consumes: ethers `Interface`, `FunctionFragment`, `ParamType`.
- Produces:
  - `class FieldError extends Error { path: string }`
  - `type FormValue = string | boolean | FormValue[] | { [k: string]: FormValue }`
  - `type FunctionEntry = { key: string; name: string; signature: string; stateMutability: string; inputs: readonly ParamType[] }` where `key` is the canonical sighash (e.g. `"grantRole(bytes32,address)"`) and `signature` is the human `full` format.
  - `parseAbi(abiJson: string): FunctionEntry[]` — writable functions only.

- [ ] **Step 1: Write the failing test**

Create `src/lib/abi-form.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- abi-form`
Expected: FAIL — cannot resolve `./abi-form`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/abi-form.ts`:

```ts
import { Interface, type ParamType } from "ethers";

export class FieldError extends Error {
  path: string;
  constructor(path: string, message: string) {
    super(message);
    this.name = "FieldError";
    this.path = path;
  }
}

export type FormValue =
  | string
  | boolean
  | FormValue[]
  | { [key: string]: FormValue };

export type FunctionEntry = {
  key: string; // canonical sighash, e.g. "grantRole(bytes32,address)"
  name: string;
  signature: string; // human-readable "full" format
  stateMutability: string;
  inputs: readonly ParamType[];
};

export const parseAbi = (abiJson: string): FunctionEntry[] => {
  const iface = new Interface(abiJson);
  const entries: FunctionEntry[] = [];
  iface.forEachFunction((fragment) => {
    if (
      fragment.stateMutability === "view" ||
      fragment.stateMutability === "pure"
    ) {
      return;
    }
    entries.push({
      key: fragment.format("sighash"),
      name: fragment.name,
      signature: fragment.format("full"),
      stateMutability: fragment.stateMutability,
      inputs: fragment.inputs,
    });
  });
  return entries;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- abi-form`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/abi-form.ts src/lib/abi-form.test.ts
git commit -m "feat: parseAbi and core abi-form types"
```

---

### Task 3: `abi-form` — build + validate + encode

**Files:**
- Modify: `src/lib/abi-form.ts`
- Modify: `src/lib/abi-form.test.ts`

**Interfaces:**
- Consumes: `FunctionEntry`, `FormValue`, `FieldError`, `parseAbi`, ethers `Interface`, `isAddress`, `isHexString`.
- Produces:
  - `buildInitialValue(param: ParamType): FormValue`
  - `toEncodeArg(param: ParamType, value: FormValue, path?: string): unknown`
  - `encodeCall(abiJson: string, entry: FunctionEntry, values: FormValue[]): string`

Encoding rules (leaves): `bool`→boolean; `string`→pass through (no trim); dynamic `bytes`→`0x`-prefixed even-length hex (empty string becomes `"0x"`); `bytesN`→hex of exactly N bytes; `uint*`/`int*`→integer string range-checked against bit width, returned as `bigint`; `address`→checksum-agnostic validity via `isAddress`. Tuples encode as positional arrays; arrays map element-wise; fixed-length arrays must match their length.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/abi-form.test.ts`:

```ts
import { Interface } from "ethers";
import { buildInitialValue, toEncodeArg, encodeCall } from "./abi-form";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- abi-form`
Expected: FAIL — `buildInitialValue`/`toEncodeArg`/`encodeCall` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/abi-form.ts` (add `isAddress, isHexString` to the ethers import at the top so it reads `import { Interface, isAddress, isHexString, type ParamType } from "ethers";`):

```ts
export const buildInitialValue = (param: ParamType): FormValue => {
  if (param.baseType === "array") {
    const len = param.arrayLength ?? -1;
    if (len > 0 && param.arrayChildren) {
      return Array.from({ length: len }, () =>
        buildInitialValue(param.arrayChildren as ParamType),
      );
    }
    return [];
  }
  if (param.baseType === "tuple") {
    const obj: { [key: string]: FormValue } = {};
    (param.components ?? []).forEach((component, index) => {
      obj[component.name || String(index)] = buildInitialValue(component);
    });
    return obj;
  }
  if (param.baseType === "bool") {
    return false;
  }
  return "";
};

const intRange = (bits: number, signed: boolean): { min: bigint; max: bigint } => {
  if (signed) {
    const bound = 1n << BigInt(bits - 1);
    return { min: -bound, max: bound - 1n };
  }
  return { min: 0n, max: (1n << BigInt(bits)) - 1n };
};

const encodeLeaf = (param: ParamType, value: FormValue, path: string): unknown => {
  const type = param.baseType;
  if (type === "bool") {
    return Boolean(value);
  }
  if (type === "string") {
    return String(value);
  }
  const raw = String(value).trim();
  if (type === "bytes") {
    const hex = raw === "" ? "0x" : raw;
    if (!isHexString(hex) || hex.length % 2 !== 0) {
      throw new FieldError(path, "Invalid bytes: expect 0x-prefixed even-length hex.");
    }
    return hex;
  }
  if (raw === "") {
    throw new FieldError(path, "Required.");
  }
  if (type === "address") {
    if (!isAddress(raw)) {
      throw new FieldError(path, "Invalid address.");
    }
    return raw;
  }
  if (type.startsWith("bytes")) {
    const n = Number(type.slice(5));
    if (!isHexString(raw, n)) {
      throw new FieldError(path, `Invalid ${type}: expect exactly ${n} bytes of hex.`);
    }
    return raw;
  }
  if (type.startsWith("uint") || type.startsWith("int")) {
    if (!/^-?\d+$/.test(raw)) {
      throw new FieldError(path, "Must be an integer.");
    }
    const signed = type.startsWith("int");
    const bits = Number((signed ? type.slice(3) : type.slice(4)) || "256");
    const parsed = BigInt(raw);
    const { min, max } = intRange(bits, signed);
    if (parsed < min || parsed > max) {
      throw new FieldError(path, `Out of range for ${type}.`);
    }
    return parsed;
  }
  return raw;
};

export const toEncodeArg = (
  param: ParamType,
  value: FormValue,
  path?: string,
): unknown => {
  const here = path ?? (param.name || param.type);
  if (param.baseType === "array") {
    if (!Array.isArray(value)) {
      throw new FieldError(here, "Expected a list of values.");
    }
    const len = param.arrayLength ?? -1;
    if (len > 0 && value.length !== len) {
      throw new FieldError(here, `Expected exactly ${len} item(s).`);
    }
    return value.map((item, index) =>
      toEncodeArg(param.arrayChildren as ParamType, item, `${here}[${index}]`),
    );
  }
  if (param.baseType === "tuple") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new FieldError(here, "Expected tuple fields.");
    }
    const record = value as { [key: string]: FormValue };
    return (param.components ?? []).map((component, index) => {
      const key = component.name || String(index);
      return toEncodeArg(component, record[key], `${here}.${key}`);
    });
  }
  return encodeLeaf(param, value, here);
};

export const encodeCall = (
  abiJson: string,
  entry: FunctionEntry,
  values: FormValue[],
): string => {
  const iface = new Interface(abiJson);
  const args = entry.inputs.map((param, index) =>
    toEncodeArg(param, values[index], param.name || `arg${index}`),
  );
  return iface.encodeFunctionData(entry.key, args);
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- abi-form`
Expected: PASS (all `abi-form` tests, including Task 2's).

- [ ] **Step 5: Commit**

```bash
git add src/lib/abi-form.ts src/lib/abi-form.test.ts
git commit -m "feat: recursive form scaffolding, validation, and encoding"
```

---

### Task 4: `abi-form` — decode to rows

**Files:**
- Modify: `src/lib/abi-form.ts`
- Modify: `src/lib/abi-form.test.ts`

**Interfaces:**
- Consumes: `FunctionEntry`, `encodeCall`, ethers `Interface`.
- Produces:
  - `type DecodedRow = { label: string; value: string }`
  - `decodeToRows(abiJson: string, entry: FunctionEntry, calldata: string): DecodedRow[]` — labels are `"name (type)"`; BigInts render as decimal strings; tuples/arrays render as pretty JSON.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/abi-form.test.ts`:

```ts
import { decodeToRows } from "./abi-form";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- abi-form`
Expected: FAIL — `decodeToRows` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/abi-form.ts`:

```ts
export type DecodedRow = { label: string; value: string };

const serializeDecoded = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeDecoded(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => Number.isNaN(Number(key)))
        .map(([key, inner]) => [key, serializeDecoded(inner)]),
    );
  }
  return value;
};

const formatDecoded = (value: unknown): string => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(serializeDecoded(value), null, 2);
};

export const decodeToRows = (
  abiJson: string,
  entry: FunctionEntry,
  calldata: string,
): DecodedRow[] => {
  const iface = new Interface(abiJson);
  const decoded = iface.decodeFunctionData(entry.key, calldata.trim());
  return entry.inputs.map((param, index) => ({
    label: param.name ? `${param.name} (${param.type})` : param.type,
    value: formatDecoded(decoded[index]),
  }));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- abi-form`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/abi-form.ts src/lib/abi-form.test.ts
git commit -m "feat: decodeToRows for verify mode"
```

---

### Task 5: `timelock` module

**Files:**
- Create: `src/lib/timelock.ts`
- Test: `src/lib/timelock.test.ts`

**Interfaces:**
- Consumes: ethers `Interface`, `Result`.
- Produces:
  - `const ZERO_HASH: string` (`0x` + 64 zeros)
  - `const SCHEDULE_ABI: string`, `const EXECUTE_ABI: string`
  - `encodeSchedule(target: string, value: string, data: string, predecessor: string, salt: string, delay: string): string`
  - `encodeExecute(target: string, value: string, data: string, predecessor: string, salt: string): string`
  - `decodeTimelock(action: "schedule" | "execute", calldata: string): Result` (index 2 is the inner `data`)

- [ ] **Step 1: Write the failing test**

Create `src/lib/timelock.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- timelock`
Expected: FAIL — cannot resolve `./timelock`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/timelock.ts`:

```ts
import { Interface, type Result } from "ethers";

export const ZERO_HASH = "0x" + "0".repeat(64);

export const SCHEDULE_ABI =
  '[{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"},{"internalType":"bytes32","name":"predecessor","type":"bytes32"},{"internalType":"bytes32","name":"salt","type":"bytes32"},{"internalType":"uint256","name":"delay","type":"uint256"}],"name":"schedule","outputs":[],"stateMutability":"nonpayable","type":"function"}]';

export const EXECUTE_ABI =
  '[{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"},{"internalType":"bytes32","name":"predecessor","type":"bytes32"},{"internalType":"bytes32","name":"salt","type":"bytes32"}],"name":"execute","outputs":[],"stateMutability":"payable","type":"function"}]';

export const encodeSchedule = (
  target: string,
  value: string,
  data: string,
  predecessor: string,
  salt: string,
  delay: string,
): string =>
  new Interface(SCHEDULE_ABI).encodeFunctionData("schedule", [
    target,
    value,
    data,
    predecessor,
    salt,
    delay,
  ]);

export const encodeExecute = (
  target: string,
  value: string,
  data: string,
  predecessor: string,
  salt: string,
): string =>
  new Interface(EXECUTE_ABI).encodeFunctionData("execute", [
    target,
    value,
    data,
    predecessor,
    salt,
  ]);

export const decodeTimelock = (
  action: "schedule" | "execute",
  calldata: string,
): Result => {
  const abi = action === "schedule" ? SCHEDULE_ABI : EXECUTE_ABI;
  return new Interface(abi).decodeFunctionData(action, calldata.trim());
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- timelock`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timelock.ts src/lib/timelock.test.ts
git commit -m "feat: OZ TimelockController schedule/execute encode + decode"
```

---

### Task 6: `explorer` module

**Files:**
- Create: `src/lib/explorer.ts`
- Test: `src/lib/explorer.test.ts`

**Interfaces:**
- Consumes: ethers `isAddress`.
- Produces:
  - `type ExplorerResult = { ok: true; abi: string } | { ok: false; error: string }`
  - `buildExplorerUrl(chainId: number, address: string, apiKey: string): string`
  - `fetchAbi(chainId: number, address: string, apiKey: string, fetchImpl?: typeof fetch): Promise<ExplorerResult>`

Uses Etherscan V2 multichain endpoint (`https://api.etherscan.io/v2/api?chainid=...`). `fetchImpl` is injectable so tests never hit the network.

- [ ] **Step 1: Write the failing test**

Create `src/lib/explorer.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- explorer`
Expected: FAIL — cannot resolve `./explorer`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/explorer.ts`:

```ts
import { isAddress } from "ethers";

export type ExplorerResult =
  | { ok: true; abi: string }
  | { ok: false; error: string };

export const buildExplorerUrl = (
  chainId: number,
  address: string,
  apiKey: string,
): string =>
  `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getabi&address=${address}&apikey=${apiKey}`;

export const fetchAbi = async (
  chainId: number,
  address: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExplorerResult> => {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, error: "API key required to fetch from explorer." };
  }
  if (!isAddress(address)) {
    return { ok: false, error: "Invalid contract address." };
  }
  let response: Response;
  try {
    response = await fetchImpl(buildExplorerUrl(chainId, address, key));
  } catch {
    return { ok: false, error: "Network error contacting explorer." };
  }
  const json = (await response.json()) as { status?: string; result?: unknown };
  if (json.status === "1" && typeof json.result === "string") {
    return { ok: true, abi: json.result };
  }
  return {
    ok: false,
    error:
      typeof json.result === "string" ? json.result : "Failed to fetch ABI.",
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- explorer`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/explorer.ts src/lib/explorer.test.ts
git commit -m "feat: explorer ABI fetch via Etherscan v2 multichain"
```

---

### Task 7: Generic chains config

**Files:**
- Modify: `src/config/chains.ts` (full rewrite)
- Test: `src/config/chains.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ChainConfig = { id: string; name: string; chainId: number; explorerSupported: boolean }`
  - `const chains: ChainConfig[]` (non-empty, unique `chainId`s)

- [ ] **Step 1: Write the failing test**

Create `src/config/chains.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chains`
Expected: FAIL — the current `chains.ts` shape has no `explorerSupported`/`chainId`-only export matching this (old objects carry vault addresses). The named import still resolves, but assertions on structure/newly-seeded chains fail. If it happens to pass, Step 3 still rewrites to the generic shape.

- [ ] **Step 3: Rewrite the file**

Replace the entire contents of `src/config/chains.ts`:

```ts
export type ChainConfig = {
  id: string;
  name: string;
  chainId: number;
  explorerSupported: boolean;
};

export const chains: ChainConfig[] = [
  { id: "eth", name: "Ethereum", chainId: 1, explorerSupported: true },
  { id: "arb1", name: "Arbitrum One", chainId: 42161, explorerSupported: true },
  { id: "op", name: "OP Mainnet", chainId: 10, explorerSupported: true },
  { id: "base", name: "Base", chainId: 8453, explorerSupported: true },
  { id: "polygon", name: "Polygon", chainId: 137, explorerSupported: true },
  { id: "eth-sepolia", name: "Ethereum Sepolia", chainId: 11155111, explorerSupported: true },
  { id: "arb-sepolia", name: "Arbitrum Sepolia", chainId: 421614, explorerSupported: true },
  { id: "base-sepolia", name: "Base Sepolia", chainId: 84532, explorerSupported: true },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chains`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config/chains.ts src/config/chains.test.ts
git commit -m "feat: generic built-in chain list"
```

---

### Task 8: UI cutover — ParamField, App, cleanup

**Files:**
- Create: `src/components/ParamField.tsx`
- Modify: `src/App.tsx` (full rewrite)
- Delete: `src/config/operations.ts`, `src/lib/abi.ts`
- Modify: `index.html` (title), `README.md`

**Interfaces:**
- Consumes: everything from Tasks 2–7 — `parseAbi`, `buildInitialValue`, `encodeCall`, `decodeToRows`, `FieldError`, `FunctionEntry`, `FormValue`, `DecodedRow`, `ZERO_HASH`, `encodeSchedule`, `encodeExecute`, `decodeTimelock`, `fetchAbi`, `chains`, ethers `isAddress`, `Result`.
- Produces: the running app. Verified by `npm run build` + `npm test` + manual dev-server check (no component tests, by design — the renderer is thin over the tested `lib` layer).

- [ ] **Step 1: Create the recursive `ParamField` component**

Create `src/components/ParamField.tsx`:

```tsx
import type { ParamType } from "ethers";
import type { FormValue } from "../lib/abi-form";

type Props = {
  param: ParamType;
  value: FormValue;
  onChange: (next: FormValue) => void;
  label?: string;
};

const labelFor = (param: ParamType, fallback?: string): string => {
  const name = param.name || fallback || param.type;
  return `${name} (${param.type})`;
};

export const ParamField = ({ param, value, onChange, label }: Props) => {
  if (param.baseType === "array") {
    const rows = Array.isArray(value) ? value : [];
    const fixed = (param.arrayLength ?? -1) > 0;
    const child = param.arrayChildren as ParamType;
    return (
      <div className="validator-field field-full">
        <div className="validator-head">
          <div>
            <span>{label ?? labelFor(param)}</span>
            <small>{fixed ? `fixed length ${param.arrayLength}` : "dynamic array"}</small>
          </div>
          {!fixed ? (
            <button
              type="button"
              className="mini-button"
              onClick={() => onChange([...rows, buildRow(child)])}
            >
              Add Row
            </button>
          ) : null}
        </div>
        <div className="validator-table">
          {rows.map((row, index) => (
            <div className="validator-row" key={`${param.type}-${index}`}>
              <div style={{ flex: 1 }}>
                <ParamField
                  param={child}
                  value={row}
                  label={`#${index}`}
                  onChange={(next) =>
                    onChange(rows.map((r, i) => (i === index ? next : r)))
                  }
                />
              </div>
              {!fixed ? (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (param.baseType === "tuple") {
    const record =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as { [key: string]: FormValue })
        : {};
    return (
      <div className="validator-field field-full">
        <div className="validator-head">
          <span>{label ?? labelFor(param)}</span>
        </div>
        <div className="form-grid compact">
          {(param.components ?? []).map((component, index) => {
            const key = component.name || String(index);
            return (
              <ParamField
                key={key}
                param={component}
                value={record[key] ?? ""}
                onChange={(next) => onChange({ ...record, [key]: next })}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (param.baseType === "bool") {
    return (
      <label className="field">
        <span>{label ?? labelFor(param)}</span>
        <select
          value={String(Boolean(value))}
          onChange={(event) => onChange(event.target.value === "true")}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </label>
    );
  }

  const isMultiline = param.baseType === "bytes" || param.baseType === "string";
  return (
    <label className={isMultiline ? "field field-full" : "field"}>
      <span>{label ?? labelFor(param)}</span>
      {isMultiline ? (
        <textarea
          rows={3}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={param.type}
        />
      ) : (
        <input
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={param.type}
        />
      )}
    </label>
  );
};

const buildRow = (param: ParamType): FormValue => {
  if (param.baseType === "tuple") {
    const obj: { [key: string]: FormValue } = {};
    (param.components ?? []).forEach((component, index) => {
      obj[component.name || String(index)] =
        component.baseType === "bool" ? false : component.baseType === "array" ? [] : "";
    });
    return obj;
  }
  if (param.baseType === "array") {
    return [];
  }
  if (param.baseType === "bool") {
    return false;
  }
  return "";
};
```

- [ ] **Step 2: Rewrite `src/App.tsx`**

Replace the entire contents of `src/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "ethers";
import { chains } from "./config/chains";
import {
  buildInitialValue,
  decodeToRows,
  encodeCall,
  FieldError,
  parseAbi,
  type DecodedRow,
  type FormValue,
  type FunctionEntry,
} from "./lib/abi-form";
import {
  ZERO_HASH,
  decodeTimelock,
  encodeExecute,
  encodeSchedule,
} from "./lib/timelock";
import { fetchAbi } from "./lib/explorer";
import { ParamField } from "./components/ParamField";

const STORAGE_KEY = "safeTimelockExplorerApiKey";
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const App = () => {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [chainId, setChainId] = useState<number>(chains[0].chainId);
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? "",
  );
  const [address, setAddress] = useState("");
  const [abiText, setAbiText] = useState("");
  const [entries, setEntries] = useState<FunctionEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [values, setValues] = useState<FormValue[]>([]);

  const [tlEnabled, setTlEnabled] = useState(false);
  const [tlAction, setTlAction] = useState<"schedule" | "execute">("schedule");
  const [tlAddress, setTlAddress] = useState("");
  const [tlPredecessor, setTlPredecessor] = useState(ZERO_HASH);
  const [tlSalt, setTlSalt] = useState(ZERO_HASH);
  const [tlDelay, setTlDelay] = useState("0");
  const [tlValue, setTlValue] = useState("0");

  const [innerCalldata, setInnerCalldata] = useState("");
  const [outerCalldata, setOuterCalldata] = useState("");
  const [decodeInput, setDecodeInput] = useState("");
  const [innerRows, setInnerRows] = useState<DecodedRow[]>([]);
  const [outerRows, setOuterRows] = useState<DecodedRow[]>([]);

  const [error, setError] = useState("");
  const [fetching, setFetching] = useState(false);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.key === selectedKey),
    [entries, selectedKey],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, apiKey);
  }, [apiKey]);

  const selectEntry = (entry: FunctionEntry) => {
    setSelectedKey(entry.key);
    setValues(entry.inputs.map((param) => buildInitialValue(param)));
    setInnerCalldata("");
    setOuterCalldata("");
    setInnerRows([]);
    setOuterRows([]);
  };

  const loadAbi = (text: string) => {
    try {
      const parsed = parseAbi(text);
      setEntries(parsed);
      setError("");
      if (parsed.length > 0) {
        selectEntry(parsed[0]);
      } else {
        setSelectedKey("");
        setValues([]);
        setError("ABI has no writable functions.");
      }
    } catch (caught) {
      setEntries([]);
      setSelectedKey("");
      setError(`Invalid ABI: ${errorText(caught)}`);
    }
  };

  const handleFetch = async () => {
    setFetching(true);
    const result = await fetchAbi(chainId, address, apiKey);
    setFetching(false);
    if (result.ok) {
      setAbiText(result.abi);
      loadAbi(result.abi);
    } else {
      setError(result.error);
    }
  };

  const handleGenerate = () => {
    try {
      if (!selectedEntry) {
        throw new Error("Load an ABI and select a function.");
      }
      if (!isAddress(address)) {
        throw new FieldError("address", "Enter a valid target contract address.");
      }
      const inner = encodeCall(abiText, selectedEntry, values);
      setInnerCalldata(inner);
      if (tlEnabled) {
        if (!isAddress(tlAddress)) {
          throw new FieldError("timelock", "Enter a valid Timelock address.");
        }
        const outer =
          tlAction === "schedule"
            ? encodeSchedule(address, tlValue, inner, tlPredecessor, tlSalt, tlDelay)
            : encodeExecute(address, tlValue, inner, tlPredecessor, tlSalt);
        setOuterCalldata(outer);
      } else {
        setOuterCalldata("");
      }
      setError("");
    } catch (caught) {
      setError(
        caught instanceof FieldError
          ? `${caught.path}: ${caught.message}`
          : errorText(caught),
      );
    }
  };

  const handleDecode = () => {
    try {
      if (!selectedEntry) {
        throw new Error("Load an ABI and select the expected function.");
      }
      const input = decodeInput.trim();
      if (!input) {
        throw new Error("Paste calldata to decode.");
      }
      if (tlEnabled) {
        const outer = decodeTimelock(tlAction, input);
        const innerData = String(outer[2]);
        const outerLabels =
          tlAction === "schedule"
            ? ["target", "value", "data", "predecessor", "salt", "delay"]
            : ["target", "value", "data", "predecessor", "salt"];
        setOuterRows(
          outerLabels.map((label, index) => ({
            label,
            value:
              typeof outer[index] === "bigint"
                ? (outer[index] as bigint).toString()
                : String(outer[index]),
          })),
        );
        setInnerRows(decodeToRows(abiText, selectedEntry, innerData));
      } else {
        setOuterRows([]);
        setInnerRows(decodeToRows(abiText, selectedEntry, input));
      }
      setError("");
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const setValueAt = (index: number, next: FormValue) => {
    setValues((current) => current.map((v, i) => (i === index ? next : v)));
  };

  return (
    <div className="shell compact-shell">
      <header className="hero compact-hero">
        <div className="hero-copy-block">
          <p className="eyebrow">Safe Ops</p>
          <h1>Timelock calldata tool</h1>
          <p className="hero-copy">
            Encode and verify Safe multisig calldata for any contract, with an
            optional OpenZeppelin Timelock wrapper. Everything runs in your
            browser.
          </p>
        </div>
      </header>

      <main className="flow-layout">
        <section className="panel flow-panel">
          <div className="section-heading">
            <h2>1. Chain &amp; contract</h2>
            <p>Chain selects the explorer endpoint. Addresses are yours to enter.</p>
          </div>
          <div className="chain-list">
            {chains.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chain-chip ${item.chainId === chainId ? "active" : ""}`}
                onClick={() => setChainId(item.chainId)}
              >
                <strong>{item.name}</strong>
                <small>Chain ID {item.chainId}</small>
              </button>
            ))}
          </div>
          <label className="field field-full">
            <span>Target contract address</span>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x..."
            />
          </label>
          <div className="field-grid compact">
            <label className="field">
              <span>Explorer API key</span>
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Etherscan v2 API key"
              />
            </label>
            <div className="field">
              <span>&nbsp;</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="mini-button"
                  disabled={fetching}
                  onClick={handleFetch}
                >
                  {fetching ? "Fetching..." : "Fetch ABI"}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setApiKey("")}
                >
                  Clear key
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="panel flow-panel">
          <div className="section-heading">
            <h2>2. ABI &amp; function</h2>
            <p>Paste an ABI (or fetch it above), then pick a function.</p>
          </div>
          <label className="field field-full">
            <span>Contract ABI (JSON)</span>
            <textarea
              rows={6}
              value={abiText}
              onChange={(event) => setAbiText(event.target.value)}
              placeholder='[{"type":"function", ...}]'
            />
          </label>
          <button type="button" className="mini-button" onClick={() => loadAbi(abiText)}>
            Load ABI
          </button>
          {entries.length > 0 ? (
            <div className="ops-list compact centered">
              {entries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={`op-chip ${entry.key === selectedKey ? "active" : ""}`}
                  onClick={() => selectEntry(entry)}
                >
                  <span>{entry.name}</span>
                  <small>{entry.stateMutability}</small>
                </button>
              ))}
            </div>
          ) : null}
          {selectedEntry ? (
            <p className="operation-copy">
              <code>{selectedEntry.signature}</code>
            </p>
          ) : null}
        </section>

        <section className="panel flow-panel">
          <div className="mode-row">
            <div className="segmented">
              <button
                type="button"
                className={mode === "encode" ? "active" : ""}
                onClick={() => {
                  setMode("encode");
                  setError("");
                }}
              >
                Encode
              </button>
              <button
                type="button"
                className={mode === "decode" ? "active" : ""}
                onClick={() => {
                  setMode("decode");
                  setError("");
                }}
              >
                Decode
              </button>
            </div>
            <label className="field">
              <span>Timelock wrapper</span>
              <select
                value={String(tlEnabled)}
                onChange={(event) => setTlEnabled(event.target.value === "true")}
              >
                <option value="false">Direct (no timelock)</option>
                <option value="true">OZ TimelockController</option>
              </select>
            </label>
          </div>

          {tlEnabled ? (
            <div className="timelock-box">
              <div className="timelock-header">
                <h3>Timelock</h3>
                <div className="segmented">
                  <button
                    type="button"
                    className={tlAction === "schedule" ? "active" : ""}
                    onClick={() => setTlAction("schedule")}
                  >
                    schedule
                  </button>
                  <button
                    type="button"
                    className={tlAction === "execute" ? "active" : ""}
                    onClick={() => setTlAction("execute")}
                  >
                    execute
                  </button>
                </div>
              </div>
              <div className="field-grid compact">
                <label className="field">
                  <span>Timelock address (send-to)</span>
                  <input
                    value={tlAddress}
                    onChange={(event) => setTlAddress(event.target.value)}
                    placeholder="0x..."
                  />
                </label>
                <label className="field">
                  <span>Value (wei)</span>
                  <input value={tlValue} onChange={(event) => setTlValue(event.target.value)} />
                </label>
                <label className="field">
                  <span>Predecessor</span>
                  <input
                    value={tlPredecessor}
                    onChange={(event) => setTlPredecessor(event.target.value)}
                    placeholder={ZERO_HASH}
                  />
                </label>
                <label className="field">
                  <span>Salt</span>
                  <input
                    value={tlSalt}
                    onChange={(event) => setTlSalt(event.target.value)}
                    placeholder={ZERO_HASH}
                  />
                </label>
                {tlAction === "schedule" ? (
                  <label className="field">
                    <span>Delay (seconds)</span>
                    <input value={tlDelay} onChange={(event) => setTlDelay(event.target.value)} />
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}

          {mode === "encode" ? (
            <div className="compact-stack">
              <div className="form-grid compact">
                {selectedEntry
                  ? selectedEntry.inputs.map((param, index) => (
                      <ParamField
                        key={`${param.name || param.type}-${index}`}
                        param={param}
                        value={values[index] ?? ""}
                        onChange={(next) => setValueAt(index, next)}
                      />
                    ))
                  : null}
              </div>
              <button
                type="button"
                className="primary-action compact-action"
                onClick={handleGenerate}
              >
                Generate calldata
              </button>
            </div>
          ) : (
            <div className="compact-stack">
              <label className="field field-full">
                <span>{tlEnabled ? "Timelock calldata" : "Direct calldata"}</span>
                <textarea
                  rows={6}
                  value={decodeInput}
                  onChange={(event) => setDecodeInput(event.target.value)}
                  placeholder="0x..."
                />
              </label>
              <button
                type="button"
                className="primary-action compact-action"
                onClick={handleDecode}
              >
                Decode calldata
              </button>
            </div>
          )}

          {error ? <p className="error-text">{error}</p> : null}
        </section>

        <section className="panel flow-panel">
          <div className="section-heading">
            <h2>3. {mode === "encode" ? "Output" : "Decoded"}</h2>
          </div>
          {mode === "encode" ? (
            <div className="result-layout">
              <OutputCard
                title={tlEnabled ? "Inner calldata" : "Direct calldata"}
                target={address || "target contract"}
                calldata={innerCalldata}
              />
              {tlEnabled ? (
                <OutputCard
                  title={`Outer ${tlAction} calldata`}
                  target={tlAddress || "timelock"}
                  calldata={outerCalldata}
                />
              ) : null}
            </div>
          ) : (
            <div className="result-layout">
              {tlEnabled ? (
                <div className="subpanel compact-panel">
                  <div className="section-heading compact">
                    <h3>Outer timelock call</h3>
                  </div>
                  <DecodedRows rows={outerRows} />
                </div>
              ) : null}
              <div className="subpanel compact-panel">
                <div className="section-heading compact">
                  <h3>{tlEnabled ? "Inner business call" : "Decoded parameters"}</h3>
                </div>
                <DecodedRows rows={innerRows} />
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

const OutputCard = ({
  title,
  target,
  calldata,
}: {
  title: string;
  target: string;
  calldata: string;
}) => (
  <div className="output-card compact-output">
    <div className="output-head">
      <h4>{title}</h4>
    </div>
    <div className="output-meta">
      <span>Target</span>
      <code>{target}</code>
    </div>
    <div className="output-meta">
      <div className="meta-head">
        <span>Calldata</span>
        {calldata ? (
          <button
            type="button"
            className="mini-button icon-button"
            onClick={() => navigator.clipboard.writeText(calldata)}
          >
            Copy
          </button>
        ) : null}
      </div>
      <pre>{calldata || "Fill the form and generate calldata."}</pre>
    </div>
  </div>
);

const DecodedRows = ({ rows }: { rows: Array<{ label: string; value: string }> }) => {
  if (rows.length === 0) {
    return <p className="empty-state">Decoded fields will appear here.</p>;
  }
  return (
    <div className="decoded-list">
      {rows.map((row) => (
        <div className="decoded-row" key={row.label}>
          <span>{row.label}</span>
          <pre>{row.value}</pre>
        </div>
      ))}
    </div>
  );
};

export default App;
```

- [ ] **Step 3: Delete the AssetVault-specific files**

Run: `git rm src/config/operations.ts src/lib/abi.ts`
Expected: both files removed (nothing else imports them after the App rewrite).

- [ ] **Step 4: Update `index.html` title**

In `index.html`, replace the `<title>` line:

```html
    <title>Safe Timelock Tool</title>
```

- [ ] **Step 5: Rewrite `README.md`**

Replace the entire contents of `README.md`:

```markdown
# Safe Timelock Tool

A client-side tool for Safe multisig signers to **encode** calldata for any
contract (from its ABI) and **decode/verify** calldata before signing, with an
optional OpenZeppelin `TimelockController` wrapper.

Everything runs in the browser. The only network request is an optional ABI
fetch from a block explorer.

## Develop

```bash
npm install
npm run dev      # start Vite dev server
npm test         # run the lib unit tests (Vitest)
npm run build    # typecheck + production build
```

## How it works

1. Pick a chain (drives the explorer endpoint).
2. Enter the target contract address; paste its ABI or fetch it by address.
3. Pick a writable function — the form is generated from its ABI types.
4. Optionally enable the OZ Timelock wrapper (schedule/execute).
5. Generate calldata, or switch to Decode to verify a calldata blob.

The explorer API key is stored only in your browser's `localStorage`; use
"Clear key" to remove it.
```

- [ ] **Step 6: Typecheck, test, and build**

Run: `npm test`
Expected: PASS — all `abi-form`, `timelock`, `explorer`, `chains` tests.

Run: `npm run build`
Expected: `tsc` reports no errors and Vite writes `dist/`.

- [ ] **Step 7: Manual dev-server smoke check**

Run: `npm run dev` (then open the shown URL).
Verify by hand, then stop the server:
1. Paste this ABI and click **Load ABI**:
   `[{"type":"function","name":"addValidators","stateMutability":"nonpayable","outputs":[],"inputs":[{"name":"validators","type":"tuple[]","components":[{"name":"signer","type":"address"},{"name":"power","type":"uint256"}]},{"name":"requiredPower","type":"uint256"}]}]`
2. `addValidators` appears; the form shows a dynamic `validators` array (Add Row) and a `requiredPower` field.
3. Enter target address `0x0000000000000000000000000000000000000009`, add one validator row (`0x0000000000000000000000000000000000000001`, `10`), set `requiredPower` `10`, click **Generate calldata** — inner calldata appears, no error.
4. Toggle Timelock → schedule, set timelock address `0x0000000000000000000000000000000000000008`, Generate — a second "Outer schedule calldata" card appears.
5. Switch to **Decode**, paste the outer calldata, click **Decode** — outer rows (target/value/data/…) and inner business rows render.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: generic ABI-driven UI, remove AssetVault specifics"
```

---

## Self-Review

**Spec coverage:**
- Fully generic, no built-in contracts → Task 8 deletes `operations.ts`; ABI is user-supplied. ✓
- OZ TimelockController, optional per-operation, user-set address → Task 5 + Task 8 timelock toggle/address. ✓
- ABI paste OR explorer fetch → Task 6 + Task 8 fetch button. ✓
- Built-in chains, free-form addresses → Task 7 + Task 8. ✓
- Output: raw calldata + target, plus decode/verify → Task 8 `OutputCard` + decode mode. No Safe JSON. ✓
- Recursive type-driven engine covering tuple[]/address[]/nested tuples → Tasks 2–4 + `ParamField`. ✓
- roleHashSelect → plain bytes32 field → falls out of leaf rendering (`bytes32` input). ✓
- localStorage key + clear control, client-side only, injectable fetch → Task 6 + Task 8. ✓
- Vitest on the lib layer; no component/E2E tests (explicit) → Tasks 1–7 tests; Task 8 verified by build + manual. ✓
- New repo, original untouched → all paths under `safe-timelock-tool`; Global Constraints forbid touching the contracts repo. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; manual step lists concrete inputs. ✓

**Type consistency:** `FunctionEntry.key` (sighash) is produced in Task 2 and consumed by `encodeCall`/`decodeToRows` (Tasks 3–4) and `App` selection (Task 8). `FormValue` shape (object keyed by `component.name || index`) is written by `buildInitialValue`/`buildRow` and read by `toEncodeArg` identically. `encodeSchedule`/`encodeExecute`/`decodeTimelock` signatures match between Task 5 and Task 8 call sites. `ExplorerResult` discriminated union checked with `.ok` in both Task 6 tests and Task 8. ✓
