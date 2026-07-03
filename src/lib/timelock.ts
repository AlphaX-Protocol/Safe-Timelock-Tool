import { AbiCoder, Interface, keccak256, type Result } from "ethers";

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

// Mirror of OZ TimelockController.hashOperation:
//   keccak256(abi.encode(target, value, data, predecessor, salt))
// The operation id ties a schedule to its execute: both calls MUST use the
// same (target, value, data, predecessor, salt) or execute() reverts with
// TimelockUnexpectedOperationState.
export const hashTimelockOperation = (
  target: string,
  value: string,
  data: string,
  predecessor: string,
  salt: string,
): string =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes", "bytes32", "bytes32"],
      [target, value, data, predecessor, salt],
    ),
  );
