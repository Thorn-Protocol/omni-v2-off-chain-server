import { AerodromeNonfungiblePositionManager__factory } from "../../typechain-types/factories/AerodromeNonfungiblePositionManager__factory";

import logger from "../../lib/winston";
import { error, log } from "winston";
import { ErrorInfo } from "ethers/lib.commonjs/utils/errors";
import { BigNumber } from "bignumber.js";
import { AerodromeCLGauge__factory, AerodromePool__factory, AerodromeSlipRouter__factory, AerodromeSlipstreamQuoter__factory } from "../../typechain-types";
import { ERC20__factory } from "../../typechain-types/factories/ERC20__factory";
import { getTimestampNow, sleep } from "../../utils/helper";
import { getAPYFromDefillama, getTVLFromDefillama } from "../DataService/DataService";
import { ethers, formatUnits, JsonRpcProvider, parseUnits, Wallet, ZeroAddress } from "ethers";
import StrategyInterface, { GetLiquidityAvailableAtAPYResponse } from "../../interfaces/StrategyInterface";
import { RPC_URL_BASE } from "../../common/config/secrets";
import { MIN_DEPOSIT_WITHDRAW } from "../../common/config/config";

export class AerodromeMsusdUsdcStrategyOnBase implements StrategyInterface {
  name: string = " Aedrome Finance msUSD-USDC Liquidity Strategy";

  minDebt: number = 0;
  maxDebt: number = 0;

  // Additional constants
  NonfungiblePositionManager: string = "0x827922686190790b37229fd06084350e74485b72";
  usdcAddress: string = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  msUsdAddress: string = "0x526728DBc96689597F85ae4cd716d4f7fCcBAE9d";
  poolAddress: string = "0xCEFc8B799A8ee5D9b312aecA73262645D664AAf7"; // msUSD/USDC pool address on
  factory: string = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A";
  pool: string = "0x7501bc8Bb51616F79bfA524E464fb7B41f0B10fB";
  router: string = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";
  quoter: string = "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0";
  staking: string = "0x3d86aed6ecc8daf71c8b50d06f38455b663265d8";

  provider: JsonRpcProvider;
  wallet: Wallet;
  decimalToken0: number = 18;
  decimalToken1: number = 6;

  token: string = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  decimalToken: number = 6;

  token0: string = "0x526728DBc96689597F85ae4cd716d4f7fCcBAE9d";
  token1: string = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  defillamaCode: string = "aae6cc3a-783b-4a76-bea7-c3edccd28d62";
  apy: number = 0;
  tvl: number = 0;
  apyUpdateTimestamp: number = 0;
  tvlUpdateTimestamp: number = 0;
  constructor(privateKey: string, minDebt: number = 0, maxDebt: number = 1_000_000) {
    this.provider = new JsonRpcProvider(RPC_URL_BASE);
    this.wallet = new Wallet(privateKey, this.provider);
    this.minDebt = minDebt;
    this.maxDebt = maxDebt;
  }

  getName(): string {
    return this.name;
  }
  async getAPY(): Promise<number> {
    let now = getTimestampNow();
    if (this.apyUpdateTimestamp < now - 300) {
      this.apy = await getAPYFromDefillama(this.defillamaCode);
      this.apyUpdateTimestamp = now;
    }
    return this.apy;
  }
  async getTVL(): Promise<number> {
    let now = getTimestampNow();
    if (this.tvlUpdateTimestamp < now - 300) {
      this.tvl = await getTVLFromDefillama(this.defillamaCode);
      this.tvlUpdateTimestamp = now;
    }
    return this.tvl;
  }

  public async deposit(amount: number) {
    if (amount < MIN_DEPOSIT_WITHDRAW) {
      logger.info(" amount is less than 0.1, skipping");
      return;
    }
    let amountBigInt = parseUnits(amount.toFixed(this.decimalToken), this.decimalToken);
    let position = await this.getPosition();
    console.log(" position ", position);

    // If no position exists, create one first
    if (!position.havePosition) {
      console.log("No position found, creating new position...");
      await this.createPosition(amount);
      // Get the newly created position
      position = await this.getPosition();
      console.log("New position created:", position);
      return;
    }

    let amountSwap = await this.getAmountSwapDeposit(amount, Number(position.tickLower), Number(position.tickUpper));
    console.log(" amountswap ", amountSwap);

    if (this.token == this.token0) {
      let balancePre = await this.getBalanceToken();
      if (balancePre.balanceToken0 < amountBigInt) throw Error(`Balance token0 ${this.token0} is less than amount ${amountBigInt}`);
      await this.swap(BigInt(amountSwap.amountSwap.toFixed(0)), true);
      await sleep(2000);
      let balancePost = await this.getBalanceToken();

      let amount0 = balancePre.balanceToken0 - balancePost.balanceToken0;
      let amount1 = balancePost.balanceToken1 - balancePre.balanceToken1;
      await this.increaseLiquidity(position.tokenId, amount0, amount1);
    } else {
      let balancePre = await this.getBalanceToken();
      if (balancePre.balanceToken1 < amountBigInt) throw Error(`Balance token is less than amount ${amountBigInt}`);
      await this.swap(BigInt(amountSwap.amountSwap.toFixed(0)), false);
      await sleep(2000);
      let balancePost = await this.getBalanceToken();
      let amount0 = balancePost.balanceToken0 - balancePre.balanceToken0;
      let amount1 = balancePre.balanceToken1 - balancePost.balanceToken1;
      await this.increaseLiquidity(position.tokenId, amount0, amount1);
    }
  }

  public async withdraw(amount: number) {
    if (amount < MIN_DEPOSIT_WITHDRAW) {
      logger.info(" amount is less than 0.1, skipping");
      return;
    }
    try {
      let amountBigInt = parseUnits(amount.toFixed(this.decimalToken), this.decimalToken);
      let position = await this.getPosition();
      console.log(" position ", position);
      let total = await this.getBalance();
      if (total < amount) throw new Error(`Insufficient balance: ${total} < ${amount}`);
      let fraction = amount / total;

      let liquidityToWithdraw = BigInt(Math.floor(fraction * Number(position.liquidity)));
      if (liquidityToWithdraw === 0n) {
        console.log("Liquidity to withdraw is 0, skipping");
        return;
      }
      const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.NonfungiblePositionManager, this.wallet);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const decreaseParams = {
        tokenId: position.tokenId,
        liquidity: liquidityToWithdraw,
        amount0Min: 0n,
        amount1Min: 0n,
        deadline,
      };

      let [expectedAmount0, expectedAmount1] = await positionManager.decreaseLiquidity.staticCall(decreaseParams);
      console.log(`Expected amounts from decrease: amount0=${expectedAmount0}, amount1=${expectedAmount1}`);

      let txDecrease = await positionManager.decreaseLiquidity(decreaseParams);
      let receiptDecrease = await txDecrease.wait();
      console.log("Decrease liquidity success", receiptDecrease?.hash);
      await sleep(1000);
      let balancePre = await this.getBalanceToken();
      await sleep(1000);
      let collectParams = {
        tokenId: position.tokenId,
        recipient: this.wallet.address,
        amount0Max: 340282366920938463463374607431768211455n, // maxUnit128
        amount1Max: 340282366920938463463374607431768211455n, // maxUnit128
      };
      let txCollect = await positionManager.collect(collectParams);
      let receiptCollect = await txCollect.wait();
      console.log("Collect success", receiptCollect?.hash);
      await sleep(1000);
      let balancePost = await this.getBalanceToken();
      let amount0Received = balancePost.balanceToken0 - balancePre.balanceToken0;
      let amount1Received = balancePost.balanceToken1 - balancePre.balanceToken1;
      console.log(`Received amounts: amount0=${amount0Received}, amount1=${amount1Received}`);

      if (this.token == this.token0) {
        // Want to withdraw to token0: swap token1 (amount1Received) to token0
        if (amount1Received > 0n) {
          await this.swap(amount1Received, false); // false: token1 to token0
        }
      } else {
        // Want to withdraw to token1: swap token0 (amount0Received) to token1
        if (amount0Received > 0n) {
          await this.swap(amount0Received, true); // true: token0 to token1
        }
      }
    } catch (e) {
      console.log(" Error withdraw", e);
    }
  }

  async getBalance(): Promise<number> {
    const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.NonfungiblePositionManager, this.provider);
    try {
      let positionId = await positionManager.tokenOfOwnerByIndex(this.wallet.address, 0);
      let position = await positionManager.positions(positionId);
      let pool = AerodromePool__factory.connect(this.pool, this.provider);
      let slot0 = await pool.slot0();
      let sqrtPriceX96 = new BigNumber(slot0.sqrtPriceX96.toString());
      let sqrtPriceLowerX96 = this.getSqrtRatioAtTick(position.tickLower);
      let sqrtPriceUpperX96 = this.getSqrtRatioAtTick(position.tickUpper);
      let { amount0Bigint, amount1Bigint } = await this.getAmounFromLiquidity(position.liquidity, sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96);
      if (amount0Bigint == 0n && amount1Bigint == 0n) {
        return 0;
      }
      let quoter = AerodromeSlipstreamQuoter__factory.connect(this.quoter, this.provider);
      const path = ethers.solidityPacked(["address", "uint24", "address"], [this.msUsdAddress, 50, this.usdcAddress]);
      let data = await quoter.quoteExactInput.staticCall(path, amount0Bigint);
      let totalAmountUSDCBigInt = data[0] + amount1Bigint;
      let result = Number(formatUnits(totalAmountUSDCBigInt, 6));
      return result;
    } catch (e: any) {
      if (e.message.includes("out of bound")) {
        return 0;
      }
      logger.error(e);
      throw e;
    }
  }
  async getPosition() {
    const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.NonfungiblePositionManager, this.provider);
    try {
      let positionId = await positionManager.tokenOfOwnerByIndex(this.wallet.address, 0);
      let position = await positionManager.positions(positionId);
      return {
        havePosition: true,
        tokenId: positionId,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: position.liquidity,
      };
    } catch (e: any) {
      if (e.message.includes("out of bound")) {
        return {
          havePosition: false,
          tokenId: 0n,
          tickLower: 0,
          tickUpper: 0,
          liquidity: 0n,
        };
      }
      logger.error(e);
      throw e;
    }
  }
  getSqrtRatioAtTick(tick: bigint): BigNumber {
    return new BigNumber(Math.floor(Math.sqrt(1.0001 ** Number(tick)) * 2 ** 96));
  }
  async getAmounFromLiquidity(liquidity: bigint, sqrtPriceX96: BigNumber, sqrtPriceLowerX96: BigNumber, sqrtPriceUpperX96: BigNumber) {
    let liquidityBigNunmber = new BigNumber(liquidity);
    let sqrtPriceX96BigNumber = new BigNumber(sqrtPriceX96);
    let sqrtPriceLowerX96BigNumber = new BigNumber(sqrtPriceLowerX96);
    let sqrtPriceUpperX96BigNumber = new BigNumber(sqrtPriceUpperX96);
    let amount0 = new BigNumber(0);
    let amount1 = new BigNumber(0);
    let sqrtPriceUpper = sqrtPriceUpperX96BigNumber.div(new BigNumber(2).pow(96));
    let sqrtPrice = sqrtPriceX96BigNumber.div(new BigNumber(2).pow(96));
    amount0 = liquidityBigNunmber.times(sqrtPriceUpper.minus(sqrtPrice)).div(sqrtPriceUpper.times(sqrtPrice));
    amount1 = liquidityBigNunmber.times(sqrtPriceX96BigNumber.minus(sqrtPriceLowerX96BigNumber)).div(new BigNumber(2).pow(96));
    let amount0Bigint = BigInt(Number(amount0.toFixed(0)));
    let amount1Bigint = BigInt(Number(amount1.toFixed(0)));
    return { amount0Bigint, amount1Bigint };
  }
  async getRatio(tickLower: number, tickUpper: number) {
    let pool = AerodromePool__factory.connect(this.pool, this.provider);
    let slot0 = await pool.slot0();
    let sqrtPriceX96 = new BigNumber(slot0.sqrtPriceX96.toString());
    let sqrtPriceLowerX96 = this.getSqrtRatioAtTick(BigInt(tickLower));
    let sqrtPriceUpperX96 = this.getSqrtRatioAtTick(BigInt(tickUpper));
    let sqrtPriceX96BigNumber = new BigNumber(sqrtPriceX96);
    let sqrtPriceLowerX96BigNumber = new BigNumber(sqrtPriceLowerX96);
    let sqrtPriceUpperX96BigNumber = new BigNumber(sqrtPriceUpperX96);
    let sqrtPriceUpper = sqrtPriceUpperX96BigNumber.div(new BigNumber(2).pow(96));
    let sqrtPrice = sqrtPriceX96BigNumber.div(new BigNumber(2).pow(96));
    let amount0 = sqrtPriceUpper.minus(sqrtPrice).div(sqrtPriceUpper.times(sqrtPrice));
    let amount1 = sqrtPriceX96BigNumber.minus(sqrtPriceLowerX96BigNumber).div(new BigNumber(2).pow(96));
    let ratio = amount0.div(amount1);
    return ratio;
  }
  async swap(amount: bigint, token0ToToken1: boolean) {
    console.log(`swap amount: ${amount}, token0ToToken1: ${token0ToToken1}`);
    let balancePre = await this.getBalanceToken();
    try {
      let tokenIn = this.token0;
      let tokenOut = this.token1;
      if (token0ToToken1 == false) {
        tokenIn = this.token1;
        tokenOut = this.token0;
      }
      if (token0ToToken1 == true) {
        if (balancePre.balanceToken0 < amount) throw Error(`Balance token0 ${balancePre.balanceToken0} is less than amount ${amount}`);
      } else {
        if (balancePre.balanceToken1 < amount) throw Error(`Balance token1 ${balancePre.balanceToken1} is less than amount ${amount}`);
      }
      let tokenInContract = ERC20__factory.connect(tokenIn, this.wallet);
      let router = AerodromeSlipRouter__factory.connect(this.router, this.wallet);
      let allowance = await tokenInContract.allowance(this.wallet.address, this.router);
      if (allowance < amount) {
        let txApprove = await tokenInContract.approve(this.router, ethers.MaxUint256);
        let txApproveReceipt = await txApprove.wait();
        console.log(" approve success ", txApproveReceipt?.hash);
      }
      let deadline = Math.floor(Date.now() / 1000) + 360;
      let tx = await router.exactInputSingle({
        tokenIn,
        tokenOut,
        tickSpacing: 50,
        recipient: this.wallet.address,
        deadline: deadline,
        amountIn: amount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      });

      let receipt = await tx.wait();
      console.log(" swap success ", receipt?.hash);
      return receipt;
    } catch (e) {
      console.log(" error swap ", e);
    }
  }
  public async increaseLiquidity(tokenId: bigint, amount0: bigint, amount1: bigint) {
    console.log(`exec increateLiquidity params: tokenId: ${tokenId}, amount0: ${amount0}, amount1: ${amount1}`);
    if (amount0 == 0n && amount1 == 0n) {
      console.log(" amount0 and amount1 is 0, skip increase liquidity");
      return;
    }
    try {
      let positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.NonfungiblePositionManager, this.wallet);
      let deadline = Math.floor(Date.now() / 1000) + 3600;

      let token0Contract = ERC20__factory.connect(this.token0, this.wallet);
      let allowanceToken0 = await token0Contract.allowance(this.wallet.address, this.NonfungiblePositionManager);
      if (allowanceToken0 < amount0) {
        let txApprove = await token0Contract.approve(this.NonfungiblePositionManager, ethers.MaxUint256);
        let txApproveReceipt = await txApprove.wait();
        console.log(" approve success ", txApproveReceipt?.hash);
      }

      let token1Contract = ERC20__factory.connect(this.token1, this.wallet);
      let allowanceToken1 = await token1Contract.allowance(this.wallet.address, this.NonfungiblePositionManager);
      if (allowanceToken1 < amount1) {
        let txApprove = await token1Contract.approve(this.NonfungiblePositionManager, ethers.MaxUint256);
        let txApproveReceipt = await txApprove.wait();
        console.log(" approve success ", txApproveReceipt?.hash);
      }

      let tx = await positionManager.increaseLiquidity({
        tokenId: tokenId,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0n,
        amount1Min: 0n,
        deadline: deadline,
      });
      let receipt = await tx.wait();
      console.log(" increase liquidity receipt ", receipt?.hash);
      return receipt;
    } catch (e) {
      console.log(" error increase liquidity ", e);
    }
  }
  public async getAmountSwapDeposit(amount: number, tickLower: number, tickUpper: number) {
    let ratio = await this.getRatio(tickLower, tickUpper);
    if (this.token == this.token0) {
      let p0on1 = await this.getPriceToken0onToken1();
      let s = BigNumber(parseUnits(amount.toFixed(this.decimalToken0), this.decimalToken0));
      let amountSwap = s.div(BigNumber(1).plus(ratio.times(p0on1)));
      return {
        amountSwap: amountSwap.toNumber(),
        amountToken0After: s.minus(amountSwap).toNumber(),
        amountToken1After: amountSwap.times(p0on1).toNumber(),
      };
    } else {
      let p1on0 = await this.getPriceToken0onToken1(); // token0 per token1
      let s = new BigNumber(parseUnits(amount.toFixed(this.decimalToken1), this.decimalToken1).toString());
      let amountSwap = s.div(new BigNumber(1).plus(new BigNumber(1).div(ratio).times(p1on0)));
      return {
        amountSwap: amountSwap.toNumber(),
        amountToken0After: amountSwap.times(p1on0).toNumber(),
        amountToken1After: s.minus(amountSwap).toNumber(),
      };
    }
  }
  public async getPriceToken1onToken0(): Promise<number> {
    let pool = AerodromePool__factory.connect(this.pool, this.provider);
    let slot0 = await pool.slot0();
    let sqrtPriceX96 = new BigNumber(slot0.sqrtPriceX96.toString());
    let sqrtP = sqrtPriceX96.div(new BigNumber(2).pow(96));
    let P = sqrtP.pow(2);
    return P.toNumber();
  }
  public async getPriceToken0onToken1(): Promise<number> {
    let priceToken1onToken0 = await this.getPriceToken1onToken0();
    let inverse = new BigNumber(1).div(priceToken1onToken0);
    return inverse.toNumber();
  }
  public async getBestTick() {
    // safe tick
    let lowerTick = -276400n;
    let upperTick = -276250n;
    return {
      lowerTick: lowerTick,
      upperTick: upperTick,
    };
  }
  public async getBalanceToken() {
    let token0 = ERC20__factory.connect(this.token0, this.provider);
    let token1 = ERC20__factory.connect(this.token1, this.provider);

    let [balanceToken0, balanceToken1] = await Promise.all([token0.balanceOf(this.wallet.address), token1.balanceOf(this.wallet.address)]);
    return {
      balanceToken0,
      balanceToken1,
    };
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
  public async createPosition(amount: number) {
    let amountBigInt = parseUnits(amount.toFixed(this.decimalToken), this.decimalToken);
    console.log("Creating new position...");

    // Get best tick range
    const { lowerTick, upperTick } = await this.getBestTick();
    console.log(`Creating position with ticks: lower=${lowerTick}, upper=${upperTick}`);

    // Get current token balances
    const balancePre = await this.getBalanceToken();
    console.log(`Balance before: token0=${balancePre.balanceToken0}, token1=${balancePre.balanceToken1}`);

    // Calculate amounts needed for the position
    const amountSwap = await this.getAmountSwapDeposit(amount, Number(lowerTick), Number(upperTick));

    console.log(`Amount to swap: ${amountSwap.amountSwap}`);

    // Perform swap to get optimal ratio
    if (this.token == this.token0) {
      // We have token0, need to swap some to token1
      if (balancePre.balanceToken0 < amountBigInt) {
        throw new Error(`Insufficient token0 balance for swap: ${balancePre.balanceToken0} < ${amountSwap.amountSwap}`);
      }

      await this.swap(BigInt(amountSwap.amountSwap.toFixed(0)), true); // true: token0 to token1

      const balancePost = await this.getBalanceToken();
      const amount0 = balancePre.balanceToken0 - balancePost.balanceToken0;
      const amount1 = balancePost.balanceToken1 - balancePre.balanceToken1;

      console.log(`After swap: amount0=${amount0}, amount1=${amount1}`);

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
      console.log(`After swap: amount0=${amount0}, amount1=${amount1}`);
      // Create position with the swapped amounts
      await this.mintPosition(lowerTick, upperTick, amount0, amount1);
    }

    console.log("Position created successfully!");
  }

  private async mintPosition(tickLower: bigint, tickUpper: bigint, amount0: bigint, amount1: bigint) {
    console.log(`Minting position: tickLower=${tickLower}, tickUpper=${tickUpper}, amount0=${amount0}, amount1=${amount1}`);

    try {
      const positionManager = AerodromeNonfungiblePositionManager__factory.connect(this.NonfungiblePositionManager, this.wallet);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // Approve tokens for position manager
      const token0Contract = ERC20__factory.connect(this.token0, this.wallet);
      const token1Contract = ERC20__factory.connect(this.token1, this.wallet);

      // Check and approve token0
      const allowanceToken0 = await token0Contract.allowance(this.wallet.address, this.NonfungiblePositionManager);
      if (allowanceToken0 < amount0) {
        const txApprove0 = await token0Contract.approve(this.NonfungiblePositionManager, ethers.MaxUint256);
        await txApprove0.wait();
        console.log("Token0 approval successful");
      }

      // Check and approve token1
      const allowanceToken1 = await token1Contract.allowance(this.wallet.address, this.NonfungiblePositionManager);
      if (allowanceToken1 < amount1) {
        const txApprove1 = await token1Contract.approve(this.NonfungiblePositionManager, ethers.MaxUint256);
        await txApprove1.wait();
        console.log("Token1 approval successful");
      }

      // Get current price for minting
      const pool = AerodromePool__factory.connect(this.pool, this.provider);
      const slot0 = await pool.slot0();
      const sqrtPriceX96 = slot0.sqrtPriceX96;

      // Mint position
      const mintParams = {
        token0: this.token0,
        token1: this.token1,
        tickSpacing: 50,
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
      console.log("Position minted successfully:", receipt?.hash);

      return receipt;
    } catch (error) {
      console.error("Error minting position:", error);
      throw error;
    }
  }
}
