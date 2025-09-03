export interface GetLiquidityAvailableAtAPYResponse {
  availableLiquidity: number;
}

// Define the BaseStrategy interface for all strategy implementations
export default interface StrategyInterface {
  name: string;

  getName(): string;

  getAPY(): Promise<number>;

  getTVL(): Promise<number>;

  getLiquidityAvailableAtAPY(targetAPY: number): Promise<GetLiquidityAvailableAtAPYResponse>;

  getBalance(): Promise<number>;

  getMinimumLiquidity(): Promise<number>;

  deposit(amount: number): Promise<void>;

  withdraw(amount: number): Promise<void>;
}
