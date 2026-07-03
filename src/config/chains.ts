export type ChainConfig = {
  id: string;
  name: string;
  chainId: number;
  explorerSupported: boolean;
};

export const chains: ChainConfig[] = [
  { id: "eth", name: "Ethereum", chainId: 1, explorerSupported: true },
  { id: "arb1", name: "Arbitrum One", chainId: 42161, explorerSupported: true },
  { id: "op", name: "OP Mainnet", chainId: 10, explorerSupported: true },
  { id: "base", name: "Base", chainId: 8453, explorerSupported: true },
  { id: "polygon", name: "Polygon", chainId: 137, explorerSupported: true },
  { id: "eth-sepolia", name: "Ethereum Sepolia", chainId: 11155111, explorerSupported: true },
  { id: "arb-sepolia", name: "Arbitrum Sepolia", chainId: 421614, explorerSupported: true },
  { id: "base-sepolia", name: "Base Sepolia", chainId: 84532, explorerSupported: true },
];
