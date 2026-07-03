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
