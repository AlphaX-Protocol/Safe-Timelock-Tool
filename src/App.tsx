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
  hashTimelockOperation,
} from "./lib/timelock";
import { presets } from "./config/presets";
import { ParamField } from "./components/ParamField";

const defaultPreset = presets[0];
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type ParamRow = { label: string; value: string };

// Per-chain memory of the last-used vault and timelock addresses.
const ADDRESS_BOOK_KEY = "safeTimelockAddressBook";
type ChainAddresses = { vault: string; timelock: string };
type AddressBook = Record<string, ChainAddresses>;

const readAddressBook = (): AddressBook => {
  try {
    const raw = localStorage.getItem(ADDRESS_BOOK_KEY);
    return raw ? (JSON.parse(raw) as AddressBook) : {};
  } catch {
    return {};
  }
};

const addressesForChain = (chainId: number): ChainAddresses =>
  readAddressBook()[String(chainId)] ?? { vault: "", timelock: "" };

const rememberAddresses = (
  chainId: number,
  addresses: ChainAddresses,
): void => {
  try {
    const book = readAddressBook();
    book[String(chainId)] = addresses;
    localStorage.setItem(ADDRESS_BOOK_KEY, JSON.stringify(book));
  } catch {
    // ignore storage failures (private mode, quota) — memory is best-effort
  }
};

const App = () => {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [chainId, setChainId] = useState<number>(chains[0].chainId);
  const [address, setAddress] = useState(
    () => addressesForChain(chains[0].chainId).vault,
  );
  const [abiText, setAbiText] = useState(defaultPreset?.abiJson ?? "");
  const [entries, setEntries] = useState<FunctionEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [values, setValues] = useState<FormValue[]>([]);

  const [tlAction, setTlAction] = useState<"schedule" | "execute">("schedule");
  const [tlAddress, setTlAddress] = useState(
    () => addressesForChain(chains[0].chainId).timelock,
  );
  const [tlPredecessor, setTlPredecessor] = useState(ZERO_HASH);
  const [tlSalt, setTlSalt] = useState(ZERO_HASH);
  const [tlDelay, setTlDelay] = useState("0");
  const [tlValue, setTlValue] = useState("0");

  const [innerCalldata, setInnerCalldata] = useState("");

  const [decodeInput, setDecodeInput] = useState("");
  const [decodeWrapped, setDecodeWrapped] = useState(true);
  const [innerRows, setInnerRows] = useState<DecodedRow[]>([]);
  const [outerRows, setOuterRows] = useState<DecodedRow[]>([]);
  const [decodedOpId, setDecodedOpId] = useState("");

  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.key === selectedKey),
    [entries, selectedKey],
  );

  useEffect(() => {
    if (!copyNotice) {
      return undefined;
    }
    const timer = window.setTimeout(() => setCopyNotice(""), 1800);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);

  const handleCopy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopyNotice(label);
  };

  // Switch chains, loading that chain's remembered addresses.
  const handleSelectChain = (nextChainId: number) => {
    setChainId(nextChainId);
    const stored = addressesForChain(nextChainId);
    setAddress(stored.vault);
    setTlAddress(stored.timelock);
  };

  const handleVaultAddressChange = (next: string) => {
    setAddress(next);
    rememberAddresses(chainId, { vault: next, timelock: tlAddress });
  };

  const handleTimelockAddressChange = (next: string) => {
    setTlAddress(next);
    rememberAddresses(chainId, { vault: address, timelock: next });
  };

  const selectEntry = (entry: FunctionEntry) => {
    setSelectedKey(entry.key);
    setValues(entry.inputs.map((param) => buildInitialValue(param)));
    setInnerCalldata("");
    setInnerRows([]);
    setOuterRows([]);
    setDecodedOpId("");
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

  const loadPreset = (preset: (typeof presets)[number]) => {
    setAbiText(preset.abiJson);
    loadAbi(preset.abiJson);
  };

  // Auto-load the bundled default preset on first render so the vault interface
  // is usable without pasting or fetching an ABI.
  useEffect(() => {
    if (defaultPreset) {
      loadAbi(defaultPreset.abiJson);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2: encode the vault function call into calldata.
  const handleGenerateVault = () => {
    try {
      if (!selectedEntry) {
        throw new Error("Select a vault function first.");
      }
      const inner = encodeCall(abiText, selectedEntry, values);
      setInnerCalldata(inner);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof FieldError
          ? `${caught.path}: ${caught.message}`
          : errorText(caught),
      );
    }
  };

  // Step 3: derive the Timelock schedule/execute arguments from the vault
  // calldata. Recomputed live so editing salt/delay/etc. updates immediately.
  // The Timelock argument `target` is the vault address; the Timelock contract
  // itself is the Safe transaction's "To", not an encoded argument.
  const timelockOutput = useMemo(() => {
    if (mode !== "encode" || !innerCalldata) {
      return null;
    }
    if (!isAddress(address)) {
      return { error: "Enter a valid vault address in step 1.", params: [] as ParamRow[], outer: "", opId: "" };
    }
    try {
      const outer =
        tlAction === "schedule"
          ? encodeSchedule(address, tlValue, innerCalldata, tlPredecessor, tlSalt, tlDelay)
          : encodeExecute(address, tlValue, innerCalldata, tlPredecessor, tlSalt);
      const opId = hashTimelockOperation(address, tlValue, innerCalldata, tlPredecessor, tlSalt);
      const params: ParamRow[] = [
        { label: "target", value: address },
        { label: "value", value: tlValue },
        { label: "data", value: innerCalldata },
        { label: "predecessor", value: tlPredecessor },
        { label: "salt", value: tlSalt },
      ];
      if (tlAction === "schedule") {
        params.push({ label: "delay", value: tlDelay });
      }
      return { outer, opId, params, error: "" };
    } catch (caught) {
      return { outer: "", opId: "", params: [] as ParamRow[], error: errorText(caught) };
    }
  }, [mode, innerCalldata, address, tlAction, tlValue, tlPredecessor, tlSalt, tlDelay]);

  const handleDecode = () => {
    try {
      if (!selectedEntry) {
        throw new Error("Select the vault function this calldata calls.");
      }
      const input = decodeInput.trim();
      if (!input) {
        throw new Error("Paste calldata to decode.");
      }
      if (decodeWrapped) {
        const outer = decodeTimelock(tlAction, input);
        const innerData = String(outer.getValue("data"));
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
        setDecodedOpId(
          hashTimelockOperation(
            String(outer.getValue("target")),
            (outer.getValue("value") as bigint).toString(),
            innerData,
            String(outer.getValue("predecessor")),
            String(outer.getValue("salt")),
          ),
        );
      } else {
        setOuterRows([]);
        setDecodedOpId("");
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
      <div className="glow glow-a" />
      <div className="glow glow-b" />

      <header className="hero compact-hero">
        <div className="hero-copy-block">
          <p className="eyebrow">Safe Ops</p>
          <h1>Timelock calldata tool</h1>
          <p className="hero-copy">
            Encode a vault call, then wrap it in an OpenZeppelin Timelock
            schedule / execute — with every field laid out to paste into Safe's
            Transaction Builder. Everything runs in your browser.
          </p>
        </div>
      </header>

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
            Decode / verify
          </button>
        </div>
      </div>

      <main className="flow-layout">
        {/* Section 1: chain + vault address */}
        <section className="panel flow-panel">
          <div className="section-heading">
            <h2>1. Chain &amp; vault</h2>
            <p>Select the network and enter the vault address.</p>
          </div>
          <div className="chain-list">
            {chains.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chain-chip ${item.chainId === chainId ? "active" : ""}`}
                onClick={() => handleSelectChain(item.chainId)}
              >
                <strong>{item.name}</strong>
                <small>Chain ID {item.chainId}</small>
              </button>
            ))}
          </div>
          <label className="field field-full">
            <span>Vault address</span>
            <input
              value={address}
              onChange={(event) => handleVaultAddressChange(event.target.value)}
              placeholder="0x… (the contract the Timelock will call)"
            />
            <small>
              This becomes the Timelock call's <code>target</code> argument.
            </small>
          </label>
          <label className="field field-full">
            <span>Timelock contract (Safe → To)</span>
            <input
              value={tlAddress}
              onChange={(event) => handleTimelockAddressChange(event.target.value)}
              placeholder="0x…"
            />
            <small>
              Not an argument — this is the Safe transaction target for the
              schedule / execute call.
            </small>
          </label>
        </section>

        {/* Section 2: vault ABI & function */}
        <section className="panel flow-panel">
          <div className="section-heading">
            <h2>2. Vault ABI &amp; function</h2>
            <p>
              A bundled preset is loaded by default. Pick another preset, or
              paste an ABI to override it. Then choose a function and fill its
              parameters.
            </p>
          </div>
          {presets.length > 0 ? (
            <div className="preset-row">
              <span>Presets</span>
              <div className="preset-chips">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="mini-button"
                    onClick={() => loadPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="field field-full">
            <span>Vault ABI (JSON)</span>
            <textarea
              rows={5}
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

          {mode === "encode" ? (
            <div className="compact-stack">
              {selectedEntry && selectedEntry.inputs.length > 0 ? (
                <div className="form-grid compact">
                  {selectedEntry.inputs.map((param, index) => (
                    <ParamField
                      key={`${param.name || param.type}-${index}`}
                      param={param}
                      value={values[index] ?? ""}
                      onChange={(next) => setValueAt(index, next)}
                    />
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                className="primary-action compact-action"
                onClick={handleGenerateVault}
              >
                Generate vault calldata
              </button>
              <CopyableField
                label="Vault calldata (data)"
                value={innerCalldata}
                emptyHint="Fill the parameters and generate."
                onCopy={handleCopy}
              />
            </div>
          ) : (
            <p className="empty-state">
              Select the function this calldata is expected to call, then paste
              the calldata in step 3.
            </p>
          )}
        </section>

        {/* Section 3: timelock */}
        {mode === "encode" ? (
          <section className="panel flow-panel">
            <div className="section-heading">
              <h2>3. Timelock — {tlAction}</h2>
              <p>
                Fields to paste into Safe. <strong>To</strong> = the Timelock
                contract; the arguments below are the {tlAction} call.
              </p>
            </div>

            <div className="timelock-box">
              <div className="timelock-header">
                <h3>Timelock parameters</h3>
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
                  <span>value (wei)</span>
                  <input value={tlValue} onChange={(event) => setTlValue(event.target.value)} />
                </label>
                <label className="field">
                  <span>predecessor</span>
                  <input
                    value={tlPredecessor}
                    onChange={(event) => setTlPredecessor(event.target.value)}
                    placeholder={ZERO_HASH}
                  />
                </label>
                <label className="field">
                  <span>salt</span>
                  <input
                    value={tlSalt}
                    onChange={(event) => setTlSalt(event.target.value)}
                    placeholder={ZERO_HASH}
                  />
                  <small>
                    Identical for schedule and execute — a different salt (or
                    predecessor/target/value/data) is a different operation and
                    execute reverts.
                  </small>
                </label>
                {tlAction === "schedule" ? (
                  <label className="field">
                    <span>delay (seconds)</span>
                    <input value={tlDelay} onChange={(event) => setTlDelay(event.target.value)} />
                    <small>Must be ≥ the Timelock's minDelay.</small>
                  </label>
                ) : null}
              </div>
            </div>

            {!innerCalldata ? (
              <p className="empty-state">
                Generate the vault calldata in step 2 first — it fills the{" "}
                <code>data</code> argument below.
              </p>
            ) : timelockOutput?.error ? (
              <p className="error-text">{timelockOutput.error}</p>
            ) : timelockOutput ? (
              <div className="result-layout">
                <div className="output-card compact-output">
                  <div className="output-head">
                    <h4>{tlAction}(…) arguments — paste into Safe</h4>
                    <p>One field at a time in the Transaction Builder.</p>
                  </div>
                  <div className="output-meta">
                    <span>To (Timelock contract)</span>
                    <code>{tlAddress || "enter the Timelock address above"}</code>
                  </div>
                  <div className="tl-params">
                    {timelockOutput.params.map((param) => (
                      <CopyableField
                        key={param.label}
                        label={param.label}
                        value={param.value}
                        onCopy={handleCopy}
                        mono
                      />
                    ))}
                  </div>
                </div>

                <div className="output-card compact-output">
                  <div className="output-head">
                    <h4>Full {tlAction} calldata</h4>
                    <p>Alternative: paste one blob as raw hex data.</p>
                  </div>
                  <CopyableField
                    label="calldata"
                    value={timelockOutput.outer}
                    onCopy={handleCopy}
                  />
                  <div className="op-id-row">
                    <span>Operation ID</span>
                    <code>{timelockOutput.opId}</code>
                    <small>
                      Independent of delay. The paired execute must reproduce
                      this exact ID or it reverts.
                    </small>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="panel flow-panel">
            <div className="section-heading">
              <h2>3. Decode / verify calldata</h2>
              <p>Paste calldata to confirm what it does before signing.</p>
            </div>
            <div className="compact-stack">
              <div className="field-grid compact">
                <label className="field">
                  <span>Calldata kind</span>
                  <select
                    value={decodeWrapped ? "wrapped" : "direct"}
                    onChange={(event) => setDecodeWrapped(event.target.value === "wrapped")}
                  >
                    <option value="wrapped">Timelock schedule/execute</option>
                    <option value="direct">Direct vault calldata</option>
                  </select>
                </label>
                {decodeWrapped ? (
                  <label className="field">
                    <span>Timelock action</span>
                    <select
                      value={tlAction}
                      onChange={(event) =>
                        setTlAction(event.target.value as "schedule" | "execute")
                      }
                    >
                      <option value="schedule">schedule</option>
                      <option value="execute">execute</option>
                    </select>
                  </label>
                ) : null}
              </div>
              <label className="field field-full">
                <span>{decodeWrapped ? "Timelock calldata" : "Vault calldata"}</span>
                <textarea
                  rows={6}
                  value={decodeInput}
                  onChange={(event) => setDecodeInput(event.target.value)}
                  placeholder="0x…"
                />
              </label>
              <button
                type="button"
                className="primary-action compact-action"
                onClick={handleDecode}
              >
                Decode calldata
              </button>

              <div className="result-layout">
                {decodeWrapped ? (
                  <div className="subpanel compact-panel">
                    <div className="section-heading compact">
                      <h3>Outer timelock call</h3>
                    </div>
                    <DecodedRows rows={outerRows} />
                    {decodedOpId ? (
                      <div className="op-id-row">
                        <span>Operation ID</span>
                        <code>{decodedOpId}</code>
                        <small>
                          Must match the operation ID from the paired schedule /
                          execute.
                        </small>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="subpanel compact-panel">
                  <div className="section-heading compact">
                    <h3>{decodeWrapped ? "Inner vault call" : "Decoded parameters"}</h3>
                  </div>
                  <DecodedRows rows={innerRows} />
                </div>
              </div>
            </div>
          </section>
        )}

        {error ? <p className="error-text">{error}</p> : null}
      </main>

      {copyNotice ? <div className="copy-toast">{copyNotice}</div> : null}
    </div>
  );
};

const CopyableField = ({
  label,
  value,
  onCopy,
  emptyHint,
  mono,
}: {
  label: string;
  value: string;
  onCopy: (value: string, label: string) => Promise<void>;
  emptyHint?: string;
  mono?: boolean;
}) => (
  <div className={mono ? "tl-param-row" : "output-meta"}>
    <div className="meta-head">
      <span>{label}</span>
      {value ? (
        <button
          type="button"
          className="mini-button icon-button"
          onClick={() => onCopy(value, `${label} copied`)}
        >
          <CopyIcon />
          Copy
        </button>
      ) : null}
    </div>
    <pre>{value || emptyHint || "—"}</pre>
  </div>
);

const CopyIcon = () => (
  <svg
    aria-hidden="true"
    className="copy-icon"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5.5 2.5H11.5C12.0523 2.5 12.5 2.94772 12.5 3.5V11.5C12.5 12.0523 12.0523 12.5 11.5 12.5H5.5C4.94772 12.5 4.5 12.0523 4.5 11.5V3.5C4.5 2.94772 4.94772 2.5 5.5 2.5Z"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <path
      d="M3.5 10.5H3C2.44772 10.5 2 10.0523 2 9.5V2.99999C2 2.44771 2.44772 1.99999 3 1.99999H9.5C10.0523 1.99999 10.5 2.44771 10.5 2.99999V3.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
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
