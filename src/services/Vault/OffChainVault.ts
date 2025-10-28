import { OffChainStrategy } from "../../typechain-types/OffchainStrategy/OffChainStrategy";
import { Mutex } from "async-mutex";
import { Wallet, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import logger from "../../lib/winston";
import StrategyInterface from "../../interfaces/StrategyInterface";
import { OffChainStrategy__factory } from "../../typechain-types";
import { ERC20__factory } from "../../typechain-types/factories/ERC20__factory";
import { floorToTwoDecimals, sleep } from "../../utils/helper";
import { INTERVAL_TIME_REBALANCE } from "../../common/config/config";
import { registry } from "@coral-xyz/anchor/dist/cjs/utils";

export default class OffChainVault {
  name: string;
  strategies: StrategyInterface[];
  agent: Wallet;
  vault: OffChainStrategy;
  vaultAddress: string;
  provider: JsonRpcProvider;
  mutex: Mutex = new Mutex();

  token: string = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  tokenDecimal: number = 6;

  /**
   * Initialize the OffChainVault with vault address, agent private key, provider URL and vault name
   * @param vaultAddress - The address of the off-chain strategy vault contract
   * @param agent - Private key of the agent wallet
   * @param providerUrl - RPC provider URL for blockchain connection
   * @param name - Name identifier for this vault instance
   */
  constructor(vaultAddress: string, agent: string, providerUrl: string, name: string) {
    this.provider = new JsonRpcProvider(providerUrl);
    this.agent = new Wallet(agent, this.provider);
    logger.info(`Strategy: ${name} agent: ${this.agent.address}`);
    this.vault = OffChainStrategy__factory.connect(vaultAddress, this.agent);
    this.vaultAddress = vaultAddress;
    this.strategies = [];
    this.name = name;
  }

  async getAddressAgentRegistered() {
    let address = await this.vault.agent();
    return address;
  }

  async getAddressAgentController() {
    let address = await this.agent.getAddress();
    return address;
  }

  /**
   * Add a new strategy to the vault's strategy list
   * @param strategy - The strategy instance to add
   * @param minDebt - Minimum debt threshold for the strategy (currently unused)
   */
  async addStrategy(strategy: StrategyInterface, minDebt: number = 0) {
    this.strategies.push(strategy);
  }

  /**
   * Generate and return vault performance report
   * Update debt to the vault
   */
  async report() {
    try {
      let totalDebt = await this.vault.totalDebt();

      let realDebt = 0;

      for (let i = 0; i < this.strategies.length; i++) {
        realDebt += await this.strategies[i].getBalance();
      }

      realDebt += await this.getBalanceAgent();
      let realDebtBigInt = parseUnits(realDebt.toString(), this.tokenDecimal);

      let profit = 0n;
      let loss = 0n;

      if (realDebtBigInt > totalDebt) {
        profit = realDebtBigInt - totalDebt;
      } else {
        loss = totalDebt - realDebtBigInt;
      }
      let tx = await this.vault.updateDebt(profit, loss);
      let receipt = await tx.wait();
      logger.info(`update debt ${receipt!.hash}`);
      return { profit, loss };
    } catch (e) {
      logger.error(`report error ${e}`);
      return { profit: 0n, loss: 0n };
    }
  }

  /**
   * Enable the agent for vault operations
   * Currently not implemented
   */
  public async enableAgent() {}

  /**
   * Get the current balance of a specific strategy
   * @param strategy - The strategy to check balance for
   * @returns Promise<number> - The balance amount
   */
  async getStrategyBalance(strategy: StrategyInterface) {
    return await strategy.getBalance();
  }

  /**
   * Optimize liquidity allocation across all strategies to maximize APY
   * Uses binary search to find the optimal APY that can be achieved with available liquidity
   * @param totalAsset - Total available assets to allocate
   * @returns Object containing optimized APY, minimum liquidity requirements, and allocation data
   */
  async optimizeLiquidity(totalAsset: number) {
    // init
    let minimumLiquidity = 0;
    let data: {
      strategy: StrategyInterface;
      availableLiquidity: number;
      liquidity: number;
      minimumLiquidity: number;
    }[] = [];
    for (let i = 0; i < this.strategies.length; i++) {
      data[i] = {
        strategy: this.strategies[i],
        availableLiquidity: 0,
        liquidity: 0,
        minimumLiquidity: 0,
      };
    }

    // calculate mimimum liquidit each strategies
    for (let i = 0; i < this.strategies.length; i++) {
      let response = await this.strategies[i].getMinimumLiquidity();
      data[i].minimumLiquidity = response;
      minimumLiquidity += response;
    }

    // calculate best apr can provide with remain liquidity
    let minAPR = 0;
    let maxAPR = 100;
    while (minAPR < maxAPR - 0.001) {
      let datacache = [];
      let targetAPY = (minAPR + maxAPR) / 2;
      let availableLiquidity = 0;
      let remainLiquiditity = totalAsset - minimumLiquidity;
      for (let i = 0; i < this.strategies.length; i++) {
        let response = await this.strategies[i].getLiquidityAvailableAtAPY(targetAPY);
        availableLiquidity += response.availableLiquidity;
        if (remainLiquiditity > response.availableLiquidity) {
          remainLiquiditity -= response.availableLiquidity;
          datacache.push({
            availableLiquidity: response.availableLiquidity,
          });
        } else {
          datacache.push({
            availableLiquidity: remainLiquiditity,
          });
          remainLiquiditity = 0;
          for (let j = i + 1; j < this.strategies.length; j++) {
            datacache.push({
              availableLiquidity: 0,
            });
          }
          break;
        }
      }
      if (availableLiquidity >= totalAsset - minimumLiquidity && remainLiquiditity <= 0) {
        minAPR = targetAPY;
        for (let i = 0; i < this.strategies.length; i++) {
          data[i].availableLiquidity = datacache[i].availableLiquidity;
        }
      } else {
        maxAPR = targetAPY;
      }
    }
    for (let i = 0; i < this.strategies.length; i++) {
      data[i].liquidity = await this.getStrategyBalance(this.strategies[i]);
    }
    return {
      apy: minAPR,
      minimumLiquidity: minimumLiquidity,
      data: data,
    };
  }

  /**
   * Get the total debt balance of the vault
   * @returns Promise<number> - Total vault debt in USDC units
   */
  async getBalanceVault(): Promise<number> {
    let totalAsset = await this.vault.totalDebt();
    return Number(formatUnits(totalAsset, this.tokenDecimal));
  }

  async getRealBalance(): Promise<number> {
    let realDebt = 0;

    for (let i = 0; i < this.strategies.length; i++) {
      realDebt += await this.strategies[i].getBalance();
    }

    realDebt += await this.getBalanceAgent();

    return floorToTwoDecimals(realDebt);
  }

  /**
   * Withdraw idle funds from the vault to the agent wallet
   * Only withdraws if idle balance is >= 1 USDC
   */
  async withdrawIdleFunds() {
    let totalIdle = await this.vault.totalIdle();
    if (totalIdle >= parseUnits("1", this.tokenDecimal)) {
      let tx = await this.vault.agentWithdraw(totalIdle);
      let receipt = await tx.wait();
      logger.info(`withdraw from off chain strategy ${tx.hash}`);
    }
  }

  /**
   * Get the USDC balance of the agent wallet
   * @returns Promise<number> - Agent wallet balance in USDC units
   */
  async getBalanceAgent() {
    let usdc = ERC20__factory.connect(this.token, this.agent);
    let balance = await usdc.balanceOf(this.agent.address);
    return Number(formatUnits(balance, this.tokenDecimal));
  }

  /**
   * Main rebalancing function that optimizes liquidity across all strategies
   * 1. Withdraws idle funds from vault to agent
   * 2. Calculates optimal liquidity allocation
   * 3. Withdraws excess liquidity from over-allocated strategies
   * 4. Deposits available liquidity to under-allocated strategies
   * 5. Update debt to the vault
   */
  async rebalanceStrategies() {
    await this.withdrawIdleFunds();
    let liquidity = (await this.getRealBalance()) - 1;
    if (liquidity < 1) return;

    let newPlan = await this.optimizeLiquidity(liquidity);

    // withdraw from strategy to agent
    for (let i = 0; i < newPlan.data.length; i++) {
      let strategy = newPlan.data[i].strategy;
      let availableLiquidity = newPlan.data[i].availableLiquidity;
      let liquidity = newPlan.data[i].liquidity;
      let minimumLiquidity = newPlan.data[i].minimumLiquidity;
      if (liquidity > availableLiquidity + minimumLiquidity) {
        let amountWithdraw = liquidity - availableLiquidity - minimumLiquidity;
        logger.info(`${this.name}: withdraw from ${strategy.name} amount: ${amountWithdraw}`);
        try {
          await strategy.withdraw(amountWithdraw);
        } catch {
          logger.error(`${this.name}: withdraw from ${strategy.name} amount: ${amountWithdraw} failed`);
        }
        await sleep(2000);
      }
    }
    let remainLiquidity = await this.getBalanceAgent();
    // deposit to strategy
    for (let i = 0; i < newPlan.data.length; i++) {
      let strategy = newPlan.data[i].strategy;
      let availableLiquidity = newPlan.data[i].availableLiquidity;
      let liquidity = newPlan.data[i].liquidity;
      let minimumLiquidity = newPlan.data[i].minimumLiquidity;
      if (liquidity < availableLiquidity + minimumLiquidity) {
        let amountWithdraw = availableLiquidity + minimumLiquidity - liquidity;
        if (amountWithdraw > remainLiquidity) {
          amountWithdraw = remainLiquidity;
        }
        try {
          logger.info(`${this.name}: deposit to strategy ${strategy.name} amount ${amountWithdraw}`);
          await strategy.deposit(amountWithdraw);
        } catch (e) {
          logger.error(`${this.name}: deposit to strategy ${strategy.name} amount: ${amountWithdraw} failed ${e}`);
        }
        await sleep(2000);
        remainLiquidity = await this.getBalanceAgent();
      }
    }

    //await this.report();
  }

  /**
   * Start automatic rebalancing process with configured interval
   * Uses mutex to prevent concurrent rebalancing operations
   * Runs continuously until the application is stopped
   */
  async autoRebalance() {
    setInterval(async () => {
      if (!this.mutex.isLocked()) {
        try {
          await this.mutex.runExclusive(async () => {
            await this.rebalanceStrategies();
          });
        } catch (error) {
          logger.error(`Error in processing: ${error}`);
        }
      }
    }, INTERVAL_TIME_REBALANCE);
  }
}
