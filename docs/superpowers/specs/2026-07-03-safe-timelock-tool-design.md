# Safe Timelock Tool — Design

**Date:** 2026-07-03
**Status:** Approved (pending written-spec review)

## Summary

A standalone, client-side React + TypeScript + Vite single-page app that helps
Safe multisig signers **encode** calldata for an arbitrary target contract —
optionally wrapped in an OpenZeppelin `TimelockController` call — and
**decode/verify** calldata before signing.

It is a generic extraction and generalization of
`asset-vault-contracts/ops/web`, which was hardcoded to the AssetVault contract.
The new tool has **no built-in contracts**: the target contract's interface is
driven entirely by an ABI the user imports (paste or explorer fetch).

## Goals

- Encode calldata for any writable function of any contract, from its ABI.
- Optionally wrap the call in an OZ `TimelockController` `schedule`/`execute`.
- Decode/verify arbitrary calldata (including unwrapping the timelock layer) so
  a second signer can independently confirm what a blob does before signing.
- Stay fully client-side. No backend. The only network egress is an optional
  ABI fetch from a block explorer.

## Non-Goals (YAGNI)

- No built-in AssetVault (or any) contract catalog or role dropdowns.
- No Safe Transaction Builder JSON export. Output is raw calldata + target.
- No saved address book / named presets.
- No non-OZ timelock/wrapper models (Compound Timelock, custom wrappers).
- No component/E2E test harness.

## Decisions

| Topic | Decision |
|---|---|
| AssetVault config | Dropped entirely; tool is fully generic. |
| Timelock model | OZ `TimelockController`, optional per operation, user-set timelock address. |
| ABI import | Paste ABI JSON **or** fetch verified ABI by address from a block explorer. |
| Chains / addresses | Built-in chain list drives explorer endpoint; target & timelock addresses are free-form. |
| Output | Raw calldata + target, plus decode/verify mode. No Safe JSON. |
| Location | New git repo at `/Users/yan.he/work/dex/safe-timelock-tool`, copied from `ops/web`. |
| Form engine | Recursive type-driven renderer derived from ethers `ParamType`. |

## Architecture

Client-side SPA. Two modes: **Encode** and **Decode**.

```
ENCODE:
  1. Pick chain (built-in list)
  2. Load target ABI (paste OR fetch by address)
  3. Pick writable function -> auto-generated form
  4. (optional) Enable timelock + set timelock address/predecessor/salt/delay
  5. Generate -> inner calldata [+ outer schedule/execute calldata]

DECODE:
  Paste calldata -> decode against target ABI.
  If timelock enabled: unwrap outer schedule/execute -> decode inner data.
```

### Module boundaries

Each unit has one purpose, a well-defined interface, and is testable in
isolation.

- **`lib/abi-form.ts`** — pure, no React. The type-driven engine: ABI JSON →
  function list; `ParamType` → form-value scaffold; form-values → encode args
  (with validation); calldata → decoded rows. Bulk of unit tests live here.
- **`lib/timelock.ts`** — pure. Static OZ `TimelockController` schedule/execute
  ABIs; encode outer calldata; decode+unwrap.
- **`lib/explorer.ts`** — pure. `(chainId, address) → ABI JSON` via Etherscan V2
  multichain API. Network isolated for mocking.
- **`config/chains.ts`** — static built-in chain list (no contract addresses).
- **`components/`** — recursive `ParamField` renderer + layout, consuming
  `lib/abi-form.ts`.
- **`App.tsx`** — orchestration and state only.

### Removed from the original

- `config/operations.ts` (hardcoded AssetVault operation catalog) — deleted.
- Vault/role-specific widgets `roleHashSelect` and `validatorTupleArray` —
  absorbed by the generic recursive renderer.

## The Type-Driven Form Engine (`lib/abi-form.ts`)

ethers' `Interface` parses each function into `ParamType` nodes. Rendering,
validation, and encoding are all driven off that tree.

### Leaf type → field mapping

| ABI type | Input UI | Parse / validate |
|---|---|---|
| `address` | text | `isAddress`; pass string |
| `bool` | select true/false | boolean |
| `uint*` / `int*` | text | non-empty, integer regex, range-check vs bit-width; pass as string (ethers → BigInt) |
| `bytes` (dynamic) | textarea | `0x`-prefixed, even length hex; empty → `0x` |
| `bytes1..32` (fixed) | text | hex, exact byte length |
| `string` | textarea | pass through |

### Composites (recursive)

- `T[]` (dynamic) / `T[n]` (fixed) → add/remove rows; fixed arrays lock the
  count; each row recursively renders `T`.
- `tuple` → labeled group; each component recursively rendered by its own
  type/name.

This is why the old bespoke widgets are unnecessary: `ValidatorInfo[]` is just
`tuple(address,uint256)[]`, and `address[]` is a dynamic array of `address` —
both fall out of the recursion. A former `roleHashSelect` dropdown becomes a
plain `bytes32` field (user pastes the role hash). Losing the friendly dropdown
is the accepted cost of being fully generic.

### Public functions (all pure, no React)

- `parseAbi(abiJson: string): FunctionEntry[]` — writable functions only
  (`nonpayable` / `payable`); each carries its `ParamType[]`. Filters out
  `view` / `pure` / events.
- `buildInitialValue(paramType): FormValue` — recursive scaffold (leaf →
  `""` / `false`; array → `[]` or n rows; tuple → keyed object).
- `toEncodeArg(paramType, formValue): unknown` — recursive; throws
  `FieldError { path, message }` with a path like `validators[1].power`.
- `decodeToRows(abiJson, fn, calldata): DecodedRow[]` — for verify mode;
  formats BigInts to strings and nests tuples/arrays readably (reuses the
  existing `serializeDecoded` logic).

### Error handling

Validation throws `FieldError { path, message }`; `App` maps it to an inline
message near the field/summary. Encode/decode failures (bad hex, ABI mismatch)
surface as a single error banner.

## Timelock Layer (`lib/timelock.ts`)

Reuses the exact OZ `TimelockController` shape already in the codebase:

- `schedule(target, value, data, predecessor, salt, delay)`
- `execute(target, value, data, predecessor, salt)`

The ABIs are static constants. When timelock is enabled in encode mode, inputs
are: timelock address (free-form), predecessor (default `ZERO_HASH`), salt
(default `ZERO_HASH`), delay in seconds (schedule only), value (default `0`).
Output is **two** calldata cards — inner business calldata (target = the
contract) and outer `schedule`/`execute` calldata (target = the timelock).

In decode mode with timelock enabled: decode the outer call first (target,
value, data, predecessor, salt, [delay]), then recursively decode the inner
`data` against the target ABI — mirroring the current three-panel decode view.
Timelock off → single direct calldata card / single decode panel.

## Explorer Fetch (`lib/explorer.ts`)

- Etherscan **V2 multichain** API: base `https://api.etherscan.io/v2/api`, query
  `?chainid=<n>&module=contract&action=getabi&address=<addr>&apikey=<key>`. One
  key works across all supported chains.
- API key: user pastes it into a field, persisted to `localStorage` (key only;
  it is a low-sensitivity explorer read key, never committed). If empty, fetch
  is disabled and only paste works. A visible "clear key" control is provided.
- Success returns an ABI JSON string → feeds the same `parseAbi` path as manual
  paste.
- Proxy contracts: the explorer returns the proxy's own ABI; surface a note that
  the user may need the implementation ABI for a proxy. Paste is always the
  fallback.
- Errors (unverified, rate limit, wrong key, `status:"0"`) → inline message;
  paste remains available.

## Chains (`config/chains.ts`)

Static list of `{ id, name, chainId, explorerSupported }`. Seed: Ethereum
mainnet, Arbitrum One, Optimism, Base, Polygon, plus Sepolia, Arbitrum Sepolia,
Base Sepolia. Chain selection only drives the explorer `chainid` param and is
shown for signer context; it is **not** injected into any calldata (chainId is
not part of any encoded arg here).

## Security Posture

Handles multisig calldata, so:

- Everything is client-side. No calldata or addresses leave the browser except
  the address sent to the explorer during an optional ABI fetch.
- The explorer API key in `localStorage` is the only stored secret; a visible
  "clear key" control is provided. It is never written to the repo.

## Testing

Value is concentrated in the pure `lib/` layer; tests go there. The project has
no test runner today, so add **Vitest** (native Vite integration, minimal
config).

**`lib/abi-form.test.ts` (bulk):**
- Round-trip: `buildInitialValue` → fill → `toEncodeArg` →
  `Interface.encodeFunctionData` → `decodeFunctionData` → assert equality.
  Cover flat scalars; `address[]`; `tuple(address,uint256)[]` (the old validator
  case); a nested `tuple` containing an array; fixed `bytes32` and `uint8` edges.
- Validation: bad address, non-integer uint, out-of-range uint (`256` into
  `uint8`), odd-length / non-`0x` bytes → assert `FieldError` with correct
  `path`.
- `parseAbi`: filters `view`/`pure`/events; keeps `payable`/`nonpayable`.

**`lib/timelock.test.ts`:** schedule/execute encode produces expected outer
calldata; decode unwraps outer then inner.

**`lib/explorer.test.ts`:** URL construction per chainId; response parsing for
success and the `status:"0"` error shape (network mocked — no live calls).

No component/E2E tests — the recursive renderer is thin over the tested lib
layer; not worth the harness cost. Flagged explicitly rather than silently
skipped.

## Scaffolding & Removal

1. Copy `ops/web` → `/Users/yan.he/work/dex/safe-timelock-tool` (done during
   spec authoring), drop git remnants, `git init` (done).
2. Delete `src/config/operations.ts`; rewrite `src/config/chains.ts`; add
   `lib/abi-form.ts`, `lib/explorer.ts`, `lib/timelock.ts`; genericize `App.tsx`
   and `ParamField`.
3. Keep existing `styles.css`, Vite/TS config, `.vercelignore`.
4. Update `package.json` (name, add vitest) and `README.md`.
5. The original `asset-vault-contracts/ops/web` is left untouched — the user
   deletes it later once satisfied. This design does not modify the contracts
   repo.
