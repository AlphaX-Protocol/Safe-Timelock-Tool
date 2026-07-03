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
