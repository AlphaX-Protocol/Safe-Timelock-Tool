export type ChainConfig = {
  id: string;
  name: string;
  chainId: number;
  explorerSupported: boolean;
};

export const chains: ChainConfig[] = [
  { id: "eth", name: "Ethereum", chainId: 1, explorerSupported: true },
  { id: "arb1", name: "Arbitrum One", chainId: 42161, explorerSupported: true },
  { id: "bsc", name: "BNB Smart Chain", chainId: 56, explorerSupported: true },
];
