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
  let json: { status?: string; result?: unknown };
  try {
    json = (await response.json()) as { status?: string; result?: unknown };
  } catch {
    return { ok: false, error: "Unexpected response from explorer (not JSON)." };
  }
  if (json.status === "1" && typeof json.result === "string") {
    return { ok: true, abi: json.result };
  }
  return {
    ok: false,
    error:
      typeof json.result === "string" ? json.result : "Failed to fetch ABI.",
  };
};
