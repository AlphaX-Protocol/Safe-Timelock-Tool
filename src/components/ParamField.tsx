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
