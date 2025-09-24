import { formatUnits, JsonRpcProvider, MaxUint256, parseUnits, Wallet } from "ethers";
import StrategyInterface, { GetLiquidityAvailableAtAPYResponse } from "../../interfaces/StrategyInterface";
import { floorToTwoDecimals, getTimestampNow } from "../../utils/helper";
import { getAPYFromDefillama, getTVLFromDefillama } from "../DataService/DataService";
import { RPC_URL_BASE } from "../../common/config/secrets";
import { PoolProxyBase, PoolProxyBase__factory } from "../../typechain-types";
import logger from "../../lib/winston";
import { ERC20__factory } from "../../typechain-types/factories/ERC20__factory";
import { MIN_DEPOSIT_WITHDRAW } from "../../common/config/config";

// ==================== CONSTANTS ====================
/** Strategy name for logging and identification */
const STRATEGY_NAME = "AAVE V3 USDC Strategy On Base";

/** USDC token contract address on Base network */
const USDC_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

/** Aave V3 Pool Proxy Base contract address on Base network */
const POOL_PROXY_BASE_ADDRESS = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5"; // https://basescan.org/address/0xa238dd80c259a72e81d7e4664a9801593f98d1c5

/** USDC token decimals (6 for USDC) */
const USDC_DECIMALS = 6;

/** Defillama protocol code for fetching APY and TVL data */
const DEFILLAMA_CODE = "7e0661bf-8cf3-45e6-9424-31916d4c7b84";

/** Cache duration in seconds (5 minutes) to avoid frequent API calls */
const CACHE_DURATION_SECONDS = 300;

/**
 * Aave V3 USDC Strategy implementation for Base network
 *
 * This strategy manages USDC deposits and withdrawals on Aave V3 protocol
 * running on Base network. It provides yield farming capabilities by
 * depositing USDC into Aave V3 lending pool and earning interest.
 *
 * Features:
 * - Automatic APY and TVL fetching from Defillama with caching
 * - USDC deposit and withdrawal operations
 * - Balance checking and liquidity calculations
 * - Error handling and comprehensive logging
 */
export class AaveV3UsdcStrategyOnBase implements StrategyInterface {
  // ==================== PUBLIC PROPERTIES ====================
  /** Strategy name for identification and logging */
  public readonly name: string = STRATEGY_NAME;

  // ==================== PRIVATE PROPERTIES ====================
  /** Current APY percentage (cached for 5 minutes) */
  private apy: number = 0;

  /** Current Total Value Locked in USD (cached for 5 minutes) */
  private tvl: number = 0;

  /** Timestamp when APY was last updated */
  private apyUpdateTimestamp: number = 0;

  /** Timestamp when TVL was last updated */
  private tvlUpdateTimestamp: number = 0;

  /** Minimum debt amount for this strategy */
  private readonly minDebt: number;

  /** Maximum debt amount for this strategy */
  private readonly maxDebt: number;

  /** Ethereum JSON-RPC provider for Base network */
  private readonly provider: JsonRpcProvider;

  /** Wallet instance for signing transactions */
  private readonly wallet: Wallet;

  /** Aave V3 Pool Proxy Base contract instance */
  private readonly poolProxyBaseContract: PoolProxyBase;

  /** USDC token contract address */
  private readonly tokenAddress: string = USDC_TOKEN_ADDRESS;

  /** USDC token decimals */
  private readonly tokenDecimals: number = USDC_DECIMALS;

  /** Aave V3 Pool Proxy Base contract address */
  private readonly poolProxyBaseContractAddress: string = POOL_PROXY_BASE_ADDRESS;

  /**
   * Creates a new Aave V3 USDC Strategy instance
   *
   * @param privateKey - Private key for wallet operations
   * @param minDebt - Minimum debt amount (default: 0)
   * @param maxDebt - Maximum debt amount (default: 1,000,000)
   */
  constructor(privateKey: string, minDebt: number = 0, maxDebt: number = 1_000_000) {
    this.minDebt = minDebt;
    this.maxDebt = maxDebt;

    // Initialize provider and wallet for Base network
    this.provider = new JsonRpcProvider(RPC_URL_BASE);
    this.wallet = new Wallet(privateKey, this.provider);

    // Connect to Aave V3 Pool Proxy Base contract
    this.poolProxyBaseContract = PoolProxyBase__factory.connect(this.poolProxyBaseContractAddress, this.wallet);
  }

  /**
   * Gets the strategy name
   *
   * @returns Strategy name string
   */
  getName(): string {
    return this.name;
  }

  /**
   * Gets the current APY (Annual Percentage Yield) for the strategy
   *
   * Fetches APY from Defillama API with 5-minute caching to avoid
   * excessive API calls. Returns cached value if still valid.
   *
   * @returns Promise<number> - Current APY percentage
   * @throws Error if failed to fetch APY from Defillama
   */
  async getAPY(): Promise<number> {
    const now = getTimestampNow();
    const isCacheExpired = this.apyUpdateTimestamp < now - CACHE_DURATION_SECONDS;

    // Only fetch new APY if cache is expired
    if (isCacheExpired) {
      try {
        this.apy = await getAPYFromDefillama(DEFILLAMA_CODE);
        this.apyUpdateTimestamp = now;
      } catch (error) {
        logger.error(`${this.name}: Failed to fetch APY from Defillama:`, error);
        throw new Error(`Failed to fetch APY: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return this.apy;
  }

  /**
   * Gets the current TVL (Total Value Locked) for the strategy
   *
   * Fetches TVL from Defillama API with 5-minute caching to avoid
   * excessive API calls. Returns cached value if still valid.
   *
   * @returns Promise<number> - Current TVL in USD
   * @throws Error if failed to fetch TVL from Defillama
   */
  async getTVL(): Promise<number> {
    const now = getTimestampNow();
    const isCacheExpired = this.tvlUpdateTimestamp < now - CACHE_DURATION_SECONDS;

    // Only fetch new TVL if cache is expired
    if (isCacheExpired) {
      try {
        this.tvl = await getTVLFromDefillama(DEFILLAMA_CODE);
        this.tvlUpdateTimestamp = now;
      } catch (error) {
        logger.error(`${this.name}: Failed to fetch TVL from Defillama:`, error);
        throw new Error(`Failed to fetch TVL: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return this.tvl;
  }
  /**
   * Calculates available liquidity at a target APY
   *
   * This method determines how much additional liquidity can be added
   * to achieve a specific target APY. It calculates the difference between
   * current TVL and required TVL for the target APY.
   *
   * Formula: requiredTVL = (currentTVL * currentAPY) / targetAPY
   *
   * @param targetAPY - Target APY percentage (must be > 0)
   * @returns Promise<GetLiquidityAvailableAtAPYResponse> - Available liquidity amount
   * @throws Error if targetAPY is invalid or calculation fails
   */
  async getLiquidityAvailableAtAPY(targetAPY: number): Promise<GetLiquidityAvailableAtAPYResponse> {
    // Validate input parameter
    if (targetAPY <= 0) {
      throw new Error("Target APY must be greater than 0");
    }

    try {
      // Get current market data
      const tvl = await this.getTVL();
      const apy = await this.getAPY();

      // Calculate required TVL to achieve target APY
      const currentReward = tvl * apy; // Current total rewards
      const requiredTVL = currentReward / targetAPY; // TVL needed for target APY
      const deltaLiquidity = requiredTVL - tvl; // Additional liquidity needed

      // Return available liquidity (capped by maxDebt)
      return {
        availableLiquidity: floorToTwoDecimals(Math.max(0, Math.min(deltaLiquidity, this.maxDebt))),
      };
    } catch (error) {
      logger.error(`${this.name}: Failed to calculate liquidity at APY:`, error);
      throw new Error(`Failed to calculate liquidity: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Gets the current USDC balance in the Aave V3 pool
   *
   * This method fetches the aToken balance (representing USDC deposited
   * in Aave V3) for the wallet address. The balance is returned in
   * USDC units (not wei).
   *
   * @returns Promise<number> - Current USDC balance
   * @throws Error if failed to fetch balance from blockchain
   */
  async getBalance(): Promise<number> {
    try {
      // Get reserve data to find aToken address
      const reserveData = await this.poolProxyBaseContract.getReserveData(this.tokenAddress);
      const aTokenAddress = reserveData.aTokenAddress;

      // Connect to aToken contract and get balance
      const aTokenContract = ERC20__factory.connect(aTokenAddress, this.provider);
      const balance = await aTokenContract.balanceOf(this.wallet.address);

      // Convert from wei to USDC units
      return Number(formatUnits(balance, this.tokenDecimals));
    } catch (error) {
      logger.error(`${this.name}: Failed to get balance:`, error);
      throw new Error(`Failed to get balance: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Gets the minimum liquidity amount for this strategy
   *
   * @returns Promise<number> - Minimum liquidity amount
   */
  async getMinimumLiquidity(): Promise<number> {
    return this.minDebt;
  }

  /**
   * Deposits USDC into Aave V3 lending pool
   *
   * This method handles the complete deposit process:
   * 1. Validates minimum deposit amount
   * 2. Checks and approves USDC spending if necessary
   * 3. Executes the deposit transaction
   * 4. Logs transaction details
   *
   * @param amount - Amount of USDC to deposit (in USDC units, not wei)
   * @returns Promise<void>
   * @throws Error if deposit fails or amount is below minimum
   */
  async deposit(amount: number): Promise<void> {
    // Validate minimum deposit amount
    if (amount < MIN_DEPOSIT_WITHDRAW) {
      logger.info(`${this.name}: Amount ${amount} is less than minimum ${MIN_DEPOSIT_WITHDRAW}, skipping deposit`);
      return;
    }

    try {
      // Convert amount to BigInt (wei) for contract interaction
      const amountBigInt = parseUnits(amount.toFixed(this.tokenDecimals), this.tokenDecimals);
      const usdcContract = ERC20__factory.connect(this.tokenAddress, this.wallet);

      // Check current allowance and approve if necessary
      const allowance = await usdcContract.allowance(this.wallet.address, this.poolProxyBaseContractAddress);
      if (allowance < amountBigInt) {
        logger.info(`${this.name}: Approving USDC spending...`);
        const approveTx = await usdcContract.approve(this.poolProxyBaseContractAddress, MaxUint256);
        const approveReceipt = await approveTx.wait();
        logger.info(`${this.name}: USDC approval successful: ${approveReceipt?.hash}`);
      }

      // Execute deposit transaction
      logger.info(`${this.name}: Depositing ${amount} USDC...`);
      const depositTx = await this.poolProxyBaseContract["supply(address,uint256,address,uint16)"](
        this.tokenAddress,
        amountBigInt,
        this.wallet.address,
        0 // referral code (0 = no referral)
      );
      const depositReceipt = await depositTx.wait();
      logger.info(`${this.name}: Deposit successful: ${depositReceipt?.hash}`);
    } catch (error) {
      logger.error(`${this.name}: Deposit failed:`, error);
      throw new Error(`Deposit failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Withdraws USDC from Aave V3 lending pool
   *
   * This method handles the withdrawal process:
   * 1. Validates minimum withdrawal amount
   * 2. Executes the withdrawal transaction
   * 3. Logs transaction details
   *
   * Note: Withdrawal amount cannot exceed the available balance in the pool.
   *
   * @param amount - Amount of USDC to withdraw (in USDC units, not wei)
   * @returns Promise<void>
   * @throws Error if withdrawal fails or amount is below minimum
   */
  async withdraw(amount: number): Promise<void> {
    // Validate minimum withdrawal amount
    if (amount < MIN_DEPOSIT_WITHDRAW) {
      logger.info(`${this.name}: Amount ${amount} is less than minimum ${MIN_DEPOSIT_WITHDRAW}, skipping withdrawal`);
      return;
    }

    try {
      // Convert amount to BigInt (wei) for contract interaction
      const amountBigInt = parseUnits(amount.toFixed(this.tokenDecimals), this.tokenDecimals);

      // Execute withdrawal transaction
      logger.info(`${this.name}: Withdrawing ${amount} USDC...`);
      const withdrawTx = await this.poolProxyBaseContract["withdraw(address,uint256,address)"](this.tokenAddress, amountBigInt, this.wallet.address);
      const withdrawReceipt = await withdrawTx.wait();
      logger.info(`${this.name}: Withdrawal successful: ${withdrawReceipt?.hash}`);
    } catch (error) {
      logger.error(`${this.name}: Withdrawal failed:`, error);
      throw new Error(`Withdrawal failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
