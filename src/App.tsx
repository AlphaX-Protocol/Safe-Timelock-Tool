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
import { fetchAbi } from "./lib/explorer";
import { presets } from "./config/presets";
import { ParamField } from "./components/ParamField";

const STORAGE_KEY = "safeTimelockExplorerApiKey";
const defaultPreset = presets[0];
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const App = () => {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [chainId, setChainId] = useState<number>(chains[0].chainId);
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? "",
  );
  const [address, setAddress] = useState("");
  const [abiText, setAbiText] = useState(defaultPreset?.abiJson ?? "");
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
  const [operationId, setOperationId] = useState("");
  const [decodeInput, setDecodeInput] = useState("");
  const [innerRows, setInnerRows] = useState<DecodedRow[]>([]);
  const [outerRows, setOuterRows] = useState<DecodedRow[]>([]);
  const [decodedOpId, setDecodedOpId] = useState("");

  const [error, setError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.key === selectedKey),
    [entries, selectedKey],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, apiKey);
  }, [apiKey]);

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

  const selectEntry = (entry: FunctionEntry) => {
    setSelectedKey(entry.key);
    setValues(entry.inputs.map((param) => buildInitialValue(param)));
    setInnerCalldata("");
    setOuterCalldata("");
    setOperationId("");
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

  const handleFetch = async () => {
    setFetching(true);
    try {
      const result = await fetchAbi(chainId, address, apiKey);
      if (result.ok) {
        setAbiText(result.abi);
        loadAbi(result.abi);
      } else {
        setError(result.error);
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setFetching(false);
    }
  };

  const loadPreset = (preset: (typeof presets)[number]) => {
    setAbiText(preset.abiJson);
    loadAbi(preset.abiJson);
  };

  // Auto-load the bundled default preset on first render so the interface is
  // usable without pasting or fetching an ABI.
  useEffect(() => {
    if (defaultPreset) {
      loadAbi(defaultPreset.abiJson);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // The operation id ties schedule and execute together. It depends only
        // on (target, value, data, predecessor, salt) — NOT the delay — so the
        // same value must appear when you later encode the matching execute.
        setOperationId(
          hashTimelockOperation(address, tlValue, inner, tlPredecessor, tlSalt),
        );
      } else {
        setOuterCalldata("");
        setOperationId("");
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
        // Recompute the operation id from the decoded fields so a verifier can
        // confirm a schedule and its execute reference the same operation.
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
              <span>Fetch from explorer</span>
              <div className="field-actions">
                <button
                  type="button"
                  className="mini-button"
                  disabled={fetching}
                  onClick={handleFetch}
                >
                  {fetching ? "Fetching…" : "Fetch ABI"}
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
            <p>
              A bundled preset is loaded by default. Pick another preset, or
              paste / fetch an ABI to override it.
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
                  <small>
                    Must be identical for schedule and execute — different salt
                    (or predecessor/target/value/data) means a different
                    operation, and execute reverts.
                  </small>
                </label>
                {tlAction === "schedule" ? (
                  <label className="field">
                    <span>Delay (seconds)</span>
                    <input value={tlDelay} onChange={(event) => setTlDelay(event.target.value)} />
                    <small>Must be ≥ the TimelockController's minDelay.</small>
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
                onCopy={handleCopy}
              />
              {tlEnabled ? (
                <OutputCard
                  title={`Outer ${tlAction} calldata`}
                  target={tlAddress || "timelock"}
                  calldata={outerCalldata}
                  onCopy={handleCopy}
                />
              ) : null}
              {tlEnabled && operationId ? (
                <OperationIdCard operationId={operationId} onCopy={handleCopy} />
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
                  <h3>{tlEnabled ? "Inner business call" : "Decoded parameters"}</h3>
                </div>
                <DecodedRows rows={innerRows} />
              </div>
            </div>
          )}
        </section>
      </main>

      {copyNotice ? <div className="copy-toast">{copyNotice}</div> : null}
    </div>
  );
};

const OperationIdCard = ({
  operationId,
  onCopy,
}: {
  operationId: string;
  onCopy: (value: string, label: string) => Promise<void>;
}) => (
  <div className="output-card compact-output">
    <div className="output-head">
      <h4>Operation ID</h4>
    </div>
    <div className="output-meta">
      <div className="meta-head">
        <span>hashOperation(target, value, data, predecessor, salt)</span>
        <button
          type="button"
          className="mini-button icon-button"
          onClick={() => onCopy(operationId, "Operation ID copied")}
        >
          <CopyIcon />
          Copy
        </button>
      </div>
      <pre>{operationId}</pre>
    </div>
    <p className="operation-copy">
      Independent of delay. The paired execute must reproduce this exact ID
      (same target, value, data, predecessor, salt) or it reverts.
    </p>
  </div>
);

const OutputCard = ({
  title,
  target,
  calldata,
  onCopy,
}: {
  title: string;
  target: string;
  calldata: string;
  onCopy: (value: string, label: string) => Promise<void>;
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
            onClick={() => onCopy(calldata, "Calldata copied")}
          >
            <CopyIcon />
            Copy
          </button>
        ) : null}
      </div>
      <pre>{calldata || "Fill the form and generate calldata."}</pre>
    </div>
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
