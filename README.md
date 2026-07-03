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
