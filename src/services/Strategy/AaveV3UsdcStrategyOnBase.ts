import { formatUnits, JsonRpcProvider, MaxUint256, parseUnits, Wallet } from "ethers";
import StrategyInterface, { GetLiquidityAvailableAtAPYResponse } from "../../interfaces/StrategyInterface";
import { getTimestampNow } from "../../utils/helper";
import { getAPYFromDefillama, getTVLFromDefillama } from "../DataService/DataService";
import { RPC_URL_BASE } from "../../common/config/secrets";
import { PoolProxyBase, PoolProxyBase__factory } from "../../typechain-types";
import logger from "../../lib/winston";
import { addresses } from "../../common/config/config";
import { ERC20__factory } from "../../typechain-types/factories/ERC20__factory";
import { log } from "winston";

export class AaveV3UsdcStrategyOnBase implements StrategyInterface {
  name: string = "AAVE V3 USDC Strategy On Base";
  apy: number = 0;
  tvl: number = 0;
  apyUpdateTimestamp: number = 0;
  tvlUpdateTimestamp: number = 0;
  minDebt: number = 0;
  maxDebt: number = 0;
  provider: JsonRpcProvider;
  wallet: Wallet;
  poolProxyBaseContract: PoolProxyBase;
  // config
  token: string = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  tokenDecimals: number = 6;
  poolProxyBaseContractAddress = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5"; // https://basescan.org/address/0xa238dd80c259a72e81d7e4664a9801593f98d1c5

  constructor(privateKey: string, minDebt: number = 0, maxDebt: number = 1_000_000) {
    this.minDebt = minDebt;
    this.maxDebt = maxDebt;
    this.provider = new JsonRpcProvider(RPC_URL_BASE);
    this.wallet = new Wallet(privateKey, this.provider);
    this.poolProxyBaseContract = PoolProxyBase__factory.connect(this.poolProxyBaseContractAddress, this.wallet);
  }
  getName(): string {
    return this.name;
  }
  async getAPY(): Promise<number> {
    let defillamaCode = "7e0661bf-8cf3-45e6-9424-31916d4c7b84";
    let now = getTimestampNow();
    if (this.apyUpdateTimestamp < now - 300) {
      this.apy = await getAPYFromDefillama(defillamaCode);
      this.apyUpdateTimestamp = now;
    }
    return this.apy;
  }
  async getTVL(): Promise<number> {
    let defillamaCode = "7e0661bf-8cf3-45e6-9424-31916d4c7b84";
    let now = getTimestampNow();
    if (this.tvlUpdateTimestamp < now - 300) {
      this.tvl = await getTVLFromDefillama(defillamaCode);
      this.tvlUpdateTimestamp = now;
    }
    return this.tvl;
  }
  async getLiquidityAvailableAtAPY(targetAPY: number): Promise<GetLiquidityAvailableAtAPYResponse> {
    let tvl = await this.getTVL();
    let apy = await this.getAPY();
    let reward = tvl * apy;
    const requiredTVL = reward / targetAPY;
    const deltaLiquidity = requiredTVL - tvl;
    return {
      availableLiquidity: Math.max(0, Math.min(deltaLiquidity, this.maxDebt)),
    };
  }
  async getBalance(): Promise<number> {
    let data = await this.poolProxyBaseContract.getReserveData(this.token);
    let aTokenAddress = data.aTokenAddress;
    let aTokenContract = ERC20__factory.connect(aTokenAddress, this.provider);
    let balance = await aTokenContract.balanceOf(this.wallet.address);
    return Number(formatUnits(balance, this.tokenDecimals));
  }

  async getMinimumLiquidity(): Promise<number> {
    return this.minDebt;
  }

  async deposit(amount: number): Promise<void> {
    if (amount < 0.01) {
      logger.info(`${this.name}: amount is less than 0.01, skipping`);
      return;
    }
    let amountBigInt = parseUnits(amount.toFixed(this.tokenDecimals), this.tokenDecimals);
    let usdcContract = ERC20__factory.connect(this.token, this.wallet);
    let allowance = await usdcContract.allowance(this.wallet.address, this.poolProxyBaseContractAddress);
    if (allowance < amountBigInt) {
      let tx = await usdcContract.approve(this.poolProxyBaseContractAddress, MaxUint256);
      let receipt = await tx.wait();
      logger.info(`${this.name}: approve success ${receipt?.hash}`);
    }
    logger.info(`${this.name}: depositing amount: ${amount}`);
    let tx = await this.poolProxyBaseContract["supply(address,uint256,address,uint16)"](this.token, amountBigInt, this.wallet.address, 0);
    let receipt = await tx.wait();
    logger.info(`${this.name}: deposit success ${receipt?.hash}`);
  }
  async withdraw(amount: number): Promise<void> {
    if (amount < 0.01) {
      logger.info(`${this.name}: amount is less than 0.01, skipping`);
      return;
    }
    let amountBigInt = parseUnits(amount.toFixed(this.tokenDecimals), this.tokenDecimals);
    let tx = await this.poolProxyBaseContract["withdraw(address,uint256,address)"](this.token, amountBigInt, this.wallet.address);
    let receipt = await tx.wait();
    logger.info(`${this.name}: withdraw success ${receipt?.hash}`);
  }
}
