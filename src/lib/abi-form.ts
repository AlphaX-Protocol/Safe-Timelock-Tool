import { Interface, isAddress, isHexString, type ParamType } from "ethers";

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
