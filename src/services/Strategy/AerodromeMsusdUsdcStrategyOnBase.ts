// External imports
import { BigNumber } from "bignumber.js";
import { ethers, formatUnits, JsonRpcProvider, parseUnits, Wallet, TransactionReceipt } from "ethers";

// Internal imports
import logger from "../../lib/winston";
import { getTimestampNow, sleep } from "../../utils/helper";
import { getAPYFromDefillama, getTVLFromDefillama } from "../DataService/DataService";
import StrategyInterface, { GetLiquidityAvailableAtAPYResponse } from "../../interfaces/StrategyInterface";
import { RPC_URL_BASE } from "../../common/config/secrets";
import { MIN_DEPOSIT_WITHDRAW } from "../../common/config/config";

// Typechain imports
import { AerodromeNonfungiblePositionManager__factory } from "../../typechain-types/factories/AerodromeNonfungiblePositionManager__factory";
import { AerodromePool__factory, AerodromeSlipRouter__factory, AerodromeSlipstreamQuoter__factory } from "../../typechain-types";
import { ERC20__factory } from "../../typechain-types/factories/ERC20__factory";

// Constants
const APY_CACHE_DURATION = 300; // 5 minutes
const DEFAULT_DEADLINE_BUFFER = 3600; // 1 hour
const SWAP_DEADLINE_BUFFER = 360; // 6 minutes
const SLEEP_DURATION = 2000; // 2 seconds
const TICK_SPACING = 50;
const MAX_UINT128 = 340282366920938463463374607431768211455n;
const DEFAULT_LOWER_TICK = -276400n;
const DEFAULT_UPPER_TICK = -276250n;

// Contract addresses
const CONTRACT_ADDRESSES = {
  NONFUNGIBLE_POSITION_MANAGER: "0x827922686190790b37229fd06084350e74485b72",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  MS_USD: "0x526728DBc96689597F85ae4cd716d4f7fCcBAE9d",
  POOL: "0x7501bc8Bb51616F79bfA524E464fb7B41f0B10fB",
  ROUTER: "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5",
  QUOTER: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
  STAKING: "0x3d86aed6ecc8daf71c8b50d06f38455b663265d8",
} as const;

// Token decimals
const TOKEN_DECIMALS = {
  TOKEN0: 18,
  TOKEN1: 6,
} as const;

// External service codes
const DEFILLAMA_CODE = "aae6cc3a-783b-4a76-bea7-c3edccd28d62";

// Types and interfaces
interface Position {
  havePosition: boolean;
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

interface TokenBalance {
  balanceToken0: bigint;
  balanceToken1: bigint;
}

interface SwapAmounts {
  amountSwap: number;
  amountToken0After: number;
  amountToken1After: number;
}

interface TickRange {
  lowerTick: bigint;
  upperTick: bigint;
}

interface LiquidityAmounts {
  amount0Bigint: bigint;
  amount1Bigint: bigint;
}

export class AerodromeMsusdUsdcStrategyOnBase implements StrategyInterface {
  // Strategy properties
  name: string = "Aerodrome Finance msUSD-USDC Liquidity Strategy";
  minDebt: number = 0;
  maxDebt: number = 0;

  // Contract addresses
  private readonly nonfungiblePositionManager: string = CONTRACT_ADDRESSES.NONFUNGIBLE_POSITION_MANAGER;
  private readonly usdcAddress: string = CONTRACT_ADDRESSES.USDC;
  private readonly msUsdAddress: string = CONTRACT_ADDRESSES.MS_USD;
  private readonly pool: string = CONTRACT_ADDRESSES.POOL;
  private readonly router: string = CONTRACT_ADDRESSES.ROUTER;
  private readonly quoter: string = CONTRACT_ADDRESSES.QUOTER;
  private readonly staking: string = CONTRACT_ADDRESSES.STAKING;

  // Token configuration
  private readonly token0: string = CONTRACT_ADDRESSES.MS_USD;
  private readonly token1: string = CONTRACT_ADDRESSES.USDC;
  private readonly token: string = CONTRACT_ADDRESSES.USDC;
  private readonly decimalToken0: number = TOKEN_DECIMALS.TOKEN0;
  private readonly decimalToken1: number = TOKEN_DECIMALS.TOKEN1;
  private readonly decimalToken: number = TOKEN_DECIMALS.TOKEN1;

  // External service configuration
  private readonly defillamaCode: string = DEFILLAMA_CODE;

  // Cached data
  private apy: number = 0;
  private tvl: number = 0;
  private apyUpdateTimestamp: number = 0;
  private tvlUpdateTimestamp: number = 0;

  // Provider and wallet
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  constructor(privateKey: string, minDebt: number = 0, maxDebt: number = 1_000_000) {
    this.provider = new JsonRpcProvider(RPC_URL_BASE);
    this.wallet = new Wallet(privateKey, this.provider);
    this.minDebt = minDebt;
    this.maxDebt = maxDebt;
  }

  getName(): string {
    return this.name;
  }
  /**
   * Get current APY from DeFiLlama with caching
   * @returns Promise<number> Current APY percentage
   */
  async getAPY(): Promise<number> {
    const now = getTimestampNow();
    if (this.apyUpdateTimestamp < now - APY_CACHE_DURATION) {
      try {
        this.apy = await getAPYFromDefillama(this.defillamaCode);
        this.apyUpdateTimestamp = now;
      } catch (error) {
        logger.error("Failed to fetch APY from DeFiLlama:", error);
        throw new Error(`Failed to fetch APY: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
    return this.apy;
  }
  /**
   * Get current TVL from DeFiLlama with caching
   * @returns Promise<number> Current TVL in USD
   */
  async getTVL(): Promise<number> {
    const now = getTimestampNow();
    if (this.tvlUpdateTimestamp < now - APY_CACHE_DURATION) {
      try {
        this.tvl = await getTVLFromDefillama(this.defillamaCode);
        this.tvlUpdateTimestamp = now;
      } catch (error) {
        logger.error("Failed to fetch TVL from DeFiLlama:", error);
        throw new Error(`Failed to fetch TVL: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
    return this.tvl;
  }

  /**
   * Deposit tokens into the liquidity position
   * @param amount Amount to deposit
   */
  public async deposit(amount: number): Promise<void> {
    if (amount < MIN_DEPOSIT_WITHDRAW) {
      logger.info(`Amount ${amount} is less than minimum ${MIN_DEPOSIT_WITHDRAW}, skipping deposit`);
      return;
    }

    try {
      const amountBigInt = parseUnits(amount.toFixed(this.decimalToken), this.decimalToken);
      let position = await this.getPosition();
      logger.info("Current position:", position);

      // If no position exists, create one first
      if (!position.havePosition) {
        logger.info("No position found, creating new position...");
        await this.createPosition(amount);
        position = await this.getPosition();
        logger.info("New position created:", position);
        return;
      }

      const amountSwap = await this.getAmountSwapDeposit(amount, position.tickLower, position.tickUpper);
      logger.info("Swap amounts calculated:", amountSwap);

      if (this.token === this.token0) {
        await this.depositToken0(amountBigInt, amountSwap, position);
      } else {
        await this.depositToken1(amountBigInt, amountSwap, position);
      }
    } catch (error) {
      logger.error("Deposit failed:", error);
      throw new Error(`Deposit failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Withdraw tokens from the liquidity position
   * @param amount Amount to withdraw
   */
  public async withdraw(amount: number): Promise<void> {
    if (amount < MIN_DEPOSIT_WITHDRAW) {
      logger.info(`Amount ${amount} is less than minimum ${MIN_DEPOSIT_WITHDRAW}, skipping withdraw`);
      return;
    }

    try {
      const amountBigInt = parseUnits(amount.toFixed(this.decimalToken), this.decimalToken);
      const position = await this.getPosition();
      logger.info("Current position:", position);

      const total = await this.getBalance();
      if (total < amount) {
        throw new Error(`Insufficient balance: ${total} < ${amount}`);
      }

      const fraction = amount / total;
      const liquidityToWithdraw = BigInt(Math.floor(fraction * Number(position.liquidity)));

      if (liquidityToWithdraw === 0n) {
        logger.info("Liquidity to withdraw is 0, skipping");
        return;
      }

      // Decrease liquidity
      await this.decreaseLiquidity(position, liquidityToWithdraw);

      // Collect tokens
      const { amount0Received, amount1Received } = await this.collectTokens(position);

      // Swap tokens to desired output token
      await this.swapWithdrawnTokens(amount0Received, amount1Received);
    } catch (error) {
      logger.error("Withdraw failed:", error);
      throw new Error(`Withdraw failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get current balance in USD value
   * @returns Promise<number> Current balance in USD
   */
  async getBalance(): Promise<number> {
    const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.nonfungiblePositionManager, this.provider);

    try {
      const positionId = await positionManager.tokenOfOwnerByIndex(this.wallet.address, 0);
      const position = await positionManager.positions(positionId);
      const pool = AerodromePool__factory.connect(this.pool, this.provider);
      const slot0 = await pool.slot0();
      const sqrtPriceX96 = new BigNumber(slot0.sqrtPriceX96.toString());
      const sqrtPriceLowerX96 = this.getSqrtRatioAtTick(BigInt(position.tickLower));
      const sqrtPriceUpperX96 = this.getSqrtRatioAtTick(BigInt(position.tickUpper));

      const { amount0Bigint, amount1Bigint } = await this.getAmounFromLiquidity(position.liquidity, sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96);

      if (amount0Bigint === 0n && amount1Bigint === 0n) {
        return 0;
      }

      const quoter = AerodromeSlipstreamQuoter__factory.connect(this.quoter, this.provider);
      const path = ethers.solidityPacked(["address", "uint24", "address"], [this.msUsdAddress, TICK_SPACING, this.usdcAddress]);

      const data = await quoter.quoteExactInput.staticCall(path, amount0Bigint);
      const totalAmountUSDCBigInt = data[0] + amount1Bigint;
      const result = Number(formatUnits(totalAmountUSDCBigInt, this.decimalToken1));

      return result;
    } catch (error: any) {
      if (error.message.includes("out of bound")) {
        logger.info("No position found, returning 0 balance");
        return 0;
      }
      logger.error("Error getting balance:", error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }
  /**
   * Get current position information
   * @returns Promise<Position> Position details or empty position if none exists
   */
  async getPosition(): Promise<Position> {
    const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.nonfungiblePositionManager, this.provider);

    try {
      const positionId = await positionManager.tokenOfOwnerByIndex(this.wallet.address, 0);
      const position = await positionManager.positions(positionId);

      return {
        havePosition: true,
        tokenId: positionId,
        tickLower: Number(position.tickLower),
        tickUpper: Number(position.tickUpper),
        liquidity: position.liquidity,
      };
    } catch (error: any) {
      if (error.message.includes("out of bound")) {
        logger.info("No position found for wallet");
        return {
          havePosition: false,
          tokenId: 0n,
          tickLower: 0,
          tickUpper: 0,
          liquidity: 0n,
        };
      }
      logger.error("Error getting position:", error);
      throw new Error(`Failed to get position: ${error.message}`);
    }
  }
  /**
   * Calculate sqrt ratio at given tick
   * @param tick Tick value
   * @returns BigNumber Sqrt ratio at the tick
   */
  getSqrtRatioAtTick(tick: bigint): BigNumber {
    try {
      return new BigNumber(Math.floor(Math.sqrt(1.0001 ** Number(tick)) * 2 ** 96));
    } catch (error) {
      logger.error("Error calculating sqrt ratio at tick:", error);
      throw new Error(`Failed to calculate sqrt ratio at tick: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  /**
   * Calculate token amounts from liquidity position
   * @param liquidity Liquidity amount
   * @param sqrtPriceX96 Current sqrt price
   * @param sqrtPriceLowerX96 Lower sqrt price
   * @param sqrtPriceUpperX96 Upper sqrt price
   * @returns Promise<LiquidityAmounts> Calculated token amounts
   */
  async getAmounFromLiquidity(liquidity: bigint, sqrtPriceX96: BigNumber, sqrtPriceLowerX96: BigNumber, sqrtPriceUpperX96: BigNumber): Promise<LiquidityAmounts> {
    try {
      const liquidityBigNumber = new BigNumber(liquidity.toString());
      const sqrtPriceX96BigNumber = new BigNumber(sqrtPriceX96.toString());
      const sqrtPriceLowerX96BigNumber = new BigNumber(sqrtPriceLowerX96.toString());
      const sqrtPriceUpperX96BigNumber = new BigNumber(sqrtPriceUpperX96.toString());

      const sqrtPriceUpper = sqrtPriceUpperX96BigNumber.div(new BigNumber(2).pow(96));
      const sqrtPrice = sqrtPriceX96BigNumber.div(new BigNumber(2).pow(96));

      const amount0 = liquidityBigNumber.times(sqrtPriceUpper.minus(sqrtPrice)).div(sqrtPriceUpper.times(sqrtPrice));

      const amount1 = liquidityBigNumber.times(sqrtPriceX96BigNumber.minus(sqrtPriceLowerX96BigNumber)).div(new BigNumber(2).pow(96));

      return {
        amount0Bigint: BigInt(Number(amount0.toFixed(0))),
        amount1Bigint: BigInt(Number(amount1.toFixed(0))),
      };
    } catch (error) {
      logger.error("Error calculating amounts from liquidity:", error);
      throw new Error(`Failed to calculate amounts from liquidity: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  /**
   * Calculate ratio between token amounts for given tick range
   * @param tickLower Lower tick of the range
   * @param tickUpper Upper tick of the range
   * @returns Promise<BigNumber> Ratio between token amounts
   */
  async getRatio(tickLower: number, tickUpper: number): Promise<BigNumber> {
    try {
      const pool = AerodromePool__factory.connect(this.pool, this.provider);
      const slot0 = await pool.slot0();
      const sqrtPriceX96 = new BigNumber(slot0.sqrtPriceX96.toString());
      const sqrtPriceLowerX96 = this.getSqrtRatioAtTick(BigInt(tickLower));
      const sqrtPriceUpperX96 = this.getSqrtRatioAtTick(BigInt(tickUpper));

      const sqrtPriceX96BigNumber = new BigNumber(sqrtPriceX96);
      const sqrtPriceLowerX96BigNumber = new BigNumber(sqrtPriceLowerX96);
      const sqrtPriceUpperX96BigNumber = new BigNumber(sqrtPriceUpperX96);

      const sqrtPriceUpper = sqrtPriceUpperX96BigNumber.div(new BigNumber(2).pow(96));
      const sqrtPrice = sqrtPriceX96BigNumber.div(new BigNumber(2).pow(96));

      const amount0 = sqrtPriceUpper.minus(sqrtPrice).div(sqrtPriceUpper.times(sqrtPrice));
      const amount1 = sqrtPriceX96BigNumber.minus(sqrtPriceLowerX96BigNumber).div(new BigNumber(2).pow(96));
      const ratio = amount0.div(amount1);

      return ratio;
    } catch (error) {
      logger.error("Error calculating ratio:", error);
      throw new Error(`Failed to calculate ratio: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  /**
   * Execute a token swap
   * @param amount Amount to swap
   * @param token0ToToken1 Direction of swap (true: token0->token1, false: token1->token0)
   * @returns Promise<TransactionReceipt | undefined> Transaction receipt
   */
  async swap(amount: bigint, token0ToToken1: boolean): Promise<TransactionReceipt | undefined> {
    try {
      const balancePre = await this.getBalanceToken();

      const tokenIn = token0ToToken1 ? this.token0 : this.token1;
      const tokenOut = token0ToToken1 ? this.token1 : this.token0;

      // Validate balance
      if (token0ToToken1 && balancePre.balanceToken0 < amount) {
        throw new Error(`Insufficient token0 balance: ${balancePre.balanceToken0} < ${amount}`);
      }
      if (!token0ToToken1 && balancePre.balanceToken1 < amount) {
        throw new Error(`Insufficient token1 balance: ${balancePre.balanceToken1} < ${amount}`);
      }

      // Check and approve token allowance
      await this.ensureTokenAllowance(tokenIn, amount);

      // Execute swap
      const router = AerodromeSlipRouter__factory.connect(this.router, this.wallet);
      const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_BUFFER;

      const tx = await router.exactInputSingle({
        tokenIn,
        tokenOut,
        tickSpacing: TICK_SPACING,
        recipient: this.wallet.address,
        deadline,
        amountIn: amount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      });

      const receipt = await tx.wait();
      logger.info(`Swap successful: ${receipt?.hash}`);
      return receipt || undefined;
    } catch (error) {
      logger.error("Swap failed:", error);
      throw new Error(`Swap failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Ensure token allowance for the router
   * @param tokenAddress Token contract address
   * @param amount Required amount
   */
  private async ensureTokenAllowance(tokenAddress: string, amount: bigint): Promise<void> {
    try {
      const tokenContract = ERC20__factory.connect(tokenAddress, this.wallet);
      const allowance = await tokenContract.allowance(this.wallet.address, this.router);

      if (allowance < amount) {
        logger.info(`Approving token ${tokenAddress} for router`);
        const txApprove = await tokenContract.approve(this.router, ethers.MaxUint256);
        await txApprove.wait();
        logger.info(`Token approval successful: ${txApprove.hash}`);
      }
    } catch (error) {
      logger.error(`Failed to approve token ${tokenAddress}:`, error);
      throw new Error(`Token approval failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Ensure token allowance for the position manager
   * @param tokenAddress Token contract address
   * @param amount Required amount
   */
  private async ensureTokenAllowanceForPositionManager(tokenAddress: string, amount: bigint): Promise<void> {
    try {
      const tokenContract = ERC20__factory.connect(tokenAddress, this.wallet);
      const allowance = await tokenContract.allowance(this.wallet.address, this.nonfungiblePositionManager);

      if (allowance < amount) {
        logger.info(`Approving token ${tokenAddress} for position manager`);
        const txApprove = await tokenContract.approve(this.nonfungiblePositionManager, ethers.MaxUint256);
        await txApprove.wait();
        logger.info(`Token approval successful: ${txApprove.hash}`);
      }
    } catch (error) {
      logger.error(`Failed to approve token ${tokenAddress} for position manager:`, error);
      throw new Error(`Token approval failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Increase liquidity for an existing position
   * @param tokenId Position token ID
   * @param amount0 Desired amount of token0
   * @param amount1 Desired amount of token1
   * @returns Promise<TransactionReceipt | undefined> Transaction receipt
   */
  public async increaseLiquidity(tokenId: bigint, amount0: bigint, amount1: bigint): Promise<TransactionReceipt | undefined> {
    if (amount0 === 0n && amount1 === 0n) {
      logger.info("Amount0 and amount1 are 0, skipping increase liquidity");
      return;
    }

    try {
      const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.nonfungiblePositionManager, this.wallet);
      const deadline = Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_BUFFER;

      // Approve tokens if needed
      await this.ensureTokenAllowanceForPositionManager(this.token0, amount0);
      await this.ensureTokenAllowanceForPositionManager(this.token1, amount1);

      const tx = await positionManager.increaseLiquidity({
        tokenId,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0n,
        amount1Min: 0n,
        deadline,
      });

      const receipt = await tx.wait();
      logger.info(`Increase liquidity successful: ${receipt?.hash}`);
      return receipt || undefined;
    } catch (error) {
      logger.error("Error increasing liquidity:", error);
      throw new Error(`Failed to increase liquidity: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Handle deposit for token0
   * @param amountBigInt Amount in BigInt format
   * @param amountSwap Calculated swap amounts
   * @param position Current position
   */
  private async depositToken0(amountBigInt: bigint, amountSwap: SwapAmounts, position: Position): Promise<void> {
    const balancePre = await this.getBalanceToken();
    if (balancePre.balanceToken0 < amountBigInt) {
      throw new Error(`Insufficient token0 balance: ${balancePre.balanceToken0} < ${amountBigInt}`);
    }

    await this.swap(BigInt(amountSwap.amountSwap.toFixed(0)), true);
    await sleep(SLEEP_DURATION);

    const balancePost = await this.getBalanceToken();
    const amount0 = balancePre.balanceToken0 - balancePost.balanceToken0;
    const amount1 = balancePost.balanceToken1 - balancePre.balanceToken1;

    await this.increaseLiquidity(position.tokenId, amount0, amount1);
  }

  /**
   * Handle deposit for token1
   * @param amountBigInt Amount in BigInt format
   * @param amountSwap Calculated swap amounts
   * @param position Current position
   */
  private async depositToken1(amountBigInt: bigint, amountSwap: SwapAmounts, position: Position): Promise<void> {
    const balancePre = await this.getBalanceToken();
    if (balancePre.balanceToken1 < amountBigInt) {
      throw new Error(`Insufficient token1 balance: ${balancePre.balanceToken1} < ${amountBigInt}`);
    }

    await this.swap(BigInt(amountSwap.amountSwap.toFixed(0)), false);
    await sleep(SLEEP_DURATION);

    const balancePost = await this.getBalanceToken();
    const amount0 = balancePost.balanceToken0 - balancePre.balanceToken0;
    const amount1 = balancePre.balanceToken1 - balancePost.balanceToken1;

    await this.increaseLiquidity(position.tokenId, amount0, amount1);
  }
  /**
   * Calculate optimal swap amounts for depositing liquidity
   * @param amount Amount to deposit
   * @param tickLower Lower tick of the position
   * @param tickUpper Upper tick of the position
   * @returns Promise<SwapAmounts> Calculated swap amounts and resulting token amounts
   */
  public async getAmountSwapDeposit(amount: number, tickLower: number, tickUpper: number): Promise<SwapAmounts> {
    try {
      const ratio = await this.getRatio(tickLower, tickUpper);

      if (this.token === this.token0) {
        const p0on1 = await this.getPriceToken0onToken1();
        const s = BigNumber(parseUnits(amount.toFixed(this.decimalToken0), this.decimalToken0));
        const amountSwap = s.div(BigNumber(1).plus(ratio.times(p0on1)));

        return {
          amountSwap: amountSwap.toNumber(),
          amountToken0After: s.minus(amountSwap).toNumber(),
          amountToken1After: amountSwap.times(p0on1).toNumber(),
        };
      } else {
        const p1on0 = await this.getPriceToken0onToken1(); // token0 per token1
        const s = new BigNumber(parseUnits(amount.toFixed(this.decimalToken1), this.decimalToken1).toString());
        const amountSwap = s.div(new BigNumber(1).plus(new BigNumber(1).div(ratio).times(p1on0)));

        return {
          amountSwap: amountSwap.toNumber(),
          amountToken0After: amountSwap.times(p1on0).toNumber(),
          amountToken1After: s.minus(amountSwap).toNumber(),
        };
      }
    } catch (error) {
      logger.error("Error calculating swap amounts:", error);
      throw new Error(`Failed to calculate swap amounts: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  /**
   * Get price of token1 in terms of token0
   * @returns Promise<number> Price of token1 in token0
   */
  public async getPriceToken1onToken0(): Promise<number> {
    try {
      const pool = AerodromePool__factory.connect(this.pool, this.provider);
      const slot0 = await pool.slot0();
      const sqrtPriceX96 = new BigNumber(slot0.sqrtPriceX96.toString());
      const sqrtP = sqrtPriceX96.div(new BigNumber(2).pow(96));
      const P = sqrtP.pow(2);
      return P.toNumber();
    } catch (error) {
      logger.error("Error getting token1 price:", error);
      throw new Error(`Failed to get token1 price: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  /**
   * Get price of token0 in terms of token1
   * @returns Promise<number> Price of token0 in token1
   */
  public async getPriceToken0onToken1(): Promise<number> {
    try {
      const priceToken1onToken0 = await this.getPriceToken1onToken0();
      const inverse = new BigNumber(1).div(priceToken1onToken0);
      return inverse.toNumber();
    } catch (error) {
      logger.error("Error getting token0 price:", error);
      throw new Error(`Failed to get token0 price: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  /**
   * Get optimal tick range for the position
   * @returns Promise<TickRange> Lower and upper tick values
   */
  public async getBestTick(): Promise<TickRange> {
    // Using safe tick range for msUSD/USDC pair
    return {
      lowerTick: DEFAULT_LOWER_TICK,
      upperTick: DEFAULT_UPPER_TICK,
    };
  }
  /**
   * Get current token balances for both tokens
   * @returns Promise<TokenBalance> Current balances of token0 and token1
   */
  public async getBalanceToken(): Promise<TokenBalance> {
    try {
      const token0Contract = ERC20__factory.connect(this.token0, this.provider);
      const token1Contract = ERC20__factory.connect(this.token1, this.provider);

      const [balanceToken0, balanceToken1] = await Promise.all([token0Contract.balanceOf(this.wallet.address), token1Contract.balanceOf(this.wallet.address)]);

      return {
        balanceToken0,
        balanceToken1,
      };
    } catch (error) {
      logger.error("Error getting token balances:", error);
      throw new Error(`Failed to get token balances: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  public async getLiquidityAvailableAtAPY(targetAPY: number): Promise<GetLiquidityAvailableAtAPYResponse> {
    let apyDefillama = await this.getAPY();
    let tvlDefillama = await this.getTVL();
    let reward = tvlDefillama * apyDefillama;
    const requiredTVL = reward / targetAPY;
    const deltaLiquidity = requiredTVL - tvlDefillama;
    return {
      availableLiquidity: Math.max(0, Math.min(deltaLiquidity, this.maxDebt)),
    };
  }

  public async getMinimumLiquidity(): Promise<number> {
    return this.minDebt;
  }

  // create position
  /**
   * Create a new liquidity position
   * @param amount Amount to deposit
   */
  public async createPosition(amount: number): Promise<void> {
    try {
      const amountBigInt = parseUnits(amount.toFixed(this.decimalToken), this.decimalToken);
      // Get best tick range
      const { lowerTick, upperTick } = await this.getBestTick();
      logger.info(`Creating position with ticks: lower=${lowerTick}, upper=${upperTick}`);

      // Get current token balances
      const balancePre = await this.getBalanceToken();
      logger.info(`Balance before: token0=${balancePre.balanceToken0}, token1=${balancePre.balanceToken1}`);

      // Calculate amounts needed for the position
      const amountSwap = await this.getAmountSwapDeposit(amount, Number(lowerTick), Number(upperTick));
      logger.info(`Amount to swap: ${amountSwap.amountSwap}`);

      // Perform swap to get optimal ratio
      if (this.token === this.token0) {
        // We have token0, need to swap some to token1
        if (balancePre.balanceToken0 < amountBigInt) {
          throw new Error(`Insufficient token0 balance for swap: ${balancePre.balanceToken0} < ${amountSwap.amountSwap}`);
        }

        await this.swap(BigInt(amountSwap.amountSwap.toFixed(0)), true); // true: token0 to token1

        const balancePost = await this.getBalanceToken();
        const amount0 = balancePre.balanceToken0 - balancePost.balanceToken0;
        const amount1 = balancePost.balanceToken1 - balancePre.balanceToken1;

        logger.info(`After swap: amount0=${amount0}, amount1=${amount1}`);

        // Create position with the swapped amounts
        await this.mintPosition(lowerTick, upperTick, amount0, amount1);
      } else {
        // We have token1, need to swap some to token0
        if (balancePre.balanceToken1 < amountBigInt) {
          throw new Error(`Insufficient token1 balance for swap: ${balancePre.balanceToken1} < ${amountSwap.amountSwap}`);
        }

        await this.swap(BigInt(amountSwap.amountSwap.toFixed(0)), false); // false: token1 to token0
        await sleep(2000);
        const balancePost = await this.getBalanceToken();
        const amount0 = balancePost.balanceToken0 - balancePre.balanceToken0;
        const amount1 = balancePre.balanceToken1 - balancePost.balanceToken1;
        logger.info(`After swap: amount0=${amount0}, amount1=${amount1}`);
        // Create position with the swapped amounts
        await this.mintPosition(lowerTick, upperTick, amount0, amount1);
      }

      logger.info("Position created successfully!");
    } catch (error) {
      logger.error("Error creating position:", error);
      throw new Error(`Failed to create position: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Mint a new position with the given parameters
   * @param tickLower Lower tick of the position
   * @param tickUpper Upper tick of the position
   * @param amount0 Amount of token0
   * @param amount1 Amount of token1
   * @returns Promise<TransactionReceipt | undefined> Transaction receipt
   */
  private async mintPosition(tickLower: bigint, tickUpper: bigint, amount0: bigint, amount1: bigint): Promise<TransactionReceipt | undefined> {
    logger.info(`Minting position: tickLower=${tickLower}, tickUpper=${tickUpper}, amount0=${amount0}, amount1=${amount1}`);

    try {
      const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.nonfungiblePositionManager, this.wallet);
      const deadline = Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_BUFFER;

      // Approve tokens for position manager
      const token0Contract = ERC20__factory.connect(this.token0, this.wallet);
      const token1Contract = ERC20__factory.connect(this.token1, this.wallet);

      // Approve tokens if needed
      await this.ensureTokenAllowanceForPositionManager(this.token0, amount0);
      await this.ensureTokenAllowanceForPositionManager(this.token1, amount1);

      // Get current price for minting
      const pool = AerodromePool__factory.connect(this.pool, this.provider);
      const slot0 = await pool.slot0();
      const sqrtPriceX96 = slot0.sqrtPriceX96;

      // Mint position
      const mintParams = {
        token0: this.token0,
        token1: this.token1,
        tickSpacing: TICK_SPACING,
        tickLower: tickLower,
        tickUpper: tickUpper,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: this.wallet.address,
        deadline: deadline,
        sqrtPriceX96: 0n,
      };

      const tx = await positionManager.mint(mintParams);
      const receipt = await tx.wait();
      logger.info(`Position minted successfully: ${receipt?.hash}`);

      return receipt || undefined;
    } catch (error) {
      logger.error("Error minting position:", error);
      throw new Error(`Failed to mint position: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Decrease liquidity from position
   * @param position Current position
   * @param liquidityToWithdraw Amount of liquidity to withdraw
   */
  private async decreaseLiquidity(position: Position, liquidityToWithdraw: bigint): Promise<void> {
    const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.nonfungiblePositionManager, this.wallet);
    const deadline = Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_BUFFER;

    const decreaseParams = {
      tokenId: position.tokenId,
      liquidity: liquidityToWithdraw,
      amount0Min: 0n,
      amount1Min: 0n,
      deadline,
    };
    const txDecrease = await positionManager.decreaseLiquidity(decreaseParams);
    const receiptDecrease = await txDecrease.wait();
    logger.info(`Decrease liquidity successful: ${receiptDecrease?.hash}`);
  }

  /**
   * Collect tokens from position
   * @param position Current position
   * @returns Promise<{amount0Received: bigint, amount1Received: bigint}> Received token amounts
   */
  private async collectTokens(position: Position): Promise<{ amount0Received: bigint; amount1Received: bigint }> {
    const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.nonfungiblePositionManager, this.wallet);

    const balancePre = await this.getBalanceToken();
    await sleep(SLEEP_DURATION);

    const collectParams = {
      tokenId: position.tokenId,
      recipient: this.wallet.address,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    };

    const txCollect = await positionManager.collect(collectParams);
    const receiptCollect = await txCollect.wait();
    logger.info(`Collect successful: ${receiptCollect?.hash}`);

    await sleep(SLEEP_DURATION);
    const balancePost = await this.getBalanceToken();

    const amount0Received = balancePost.balanceToken0 - balancePre.balanceToken0;
    const amount1Received = balancePost.balanceToken1 - balancePre.balanceToken1;

    logger.info(`Received amounts: amount0=${amount0Received}, amount1=${amount1Received}`);

    return { amount0Received, amount1Received };
  }

  /**
   * Swap withdrawn tokens to desired output token
   * @param amount0Received Amount of token0 received
   * @param amount1Received Amount of token1 received
   */
  private async swapWithdrawnTokens(amount0Received: bigint, amount1Received: bigint): Promise<void> {
    if (this.token === this.token0) {
      // Want to withdraw to token0: swap token1 to token0
      if (amount1Received > 0n) {
        await this.swap(amount1Received, false); // false: token1 to token0
      }
    } else {
      // Want to withdraw to token1: swap token0 to token1
      if (amount0Received > 0n) {
        await this.swap(amount0Received, true); // true: token0 to token1
      }
    }
  }
}
