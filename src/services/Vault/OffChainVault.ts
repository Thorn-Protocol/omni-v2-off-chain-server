import { OffChainStrategy } from "../../typechain-types/OffchainStrategy/OffChainStrategy";
import { Mutex } from "async-mutex";
import { Wallet, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import logger from "../../lib/winston";
import StrategyInterface from "../../interfaces/StrategyInterface";
import { OffChainStrategy__factory } from "../../typechain-types";
import { ERC20__factory } from "../../typechain-types/factories/ERC20__factory";

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

  constructor(vaultAddress: string, agent: string, providerUrl: string, name: string) {
    this.provider = new JsonRpcProvider(providerUrl);
    this.agent = new Wallet(agent, this.provider);
    logger.info(`Strategy: ${name} agent: ${this.agent.address}`);
    this.vault = OffChainStrategy__factory.connect(vaultAddress, this.agent);
    this.vaultAddress = vaultAddress;
    this.strategies = [];
    this.name = name;
  }

  async addStrategy(strategy: StrategyInterface, minDebt: number = 0) {
    this.strategies.push(strategy);
  }

  async report() {}

  public async enableAgent() {}

  async getBalanceStrategy(strategy: StrategyInterface) {
    return await strategy.getBalance();
  }

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
      if (availableLiquidity > totalAsset && remainLiquiditity <= 0) {
        minAPR = targetAPY;

        for (let i = 0; i < this.strategies.length; i++) {
          data[i].availableLiquidity = datacache[i].availableLiquidity;
        }
      } else {
        maxAPR = targetAPY;
      }
    }

    for (let i = 0; i < this.strategies.length; i++) {
      data[i].liquidity = await this.getBalanceStrategy(this.strategies[i]);
    }
    return {
      apy: minAPR,
      minimumLiquidity: minimumLiquidity,
      data: data,
    };
  }

  async getBalanceVault(): Promise<number> {
    let totalAsset = await this.vault.totalDebt();
    return Number(formatUnits(totalAsset, this.tokenDecimal));
  }

  async withdrawFromStrategyToAgent() {
    let totalIdle = await this.vault.totalIdle();
    if (totalIdle >= parseUnits("1", this.tokenDecimal)) {
      let tx = await this.vault.agentWithdraw(totalIdle);
      let receipt = await tx.wait();
      logger.info(`withdraw from off chain strategy ${tx.hash}`);
    }
  }

  async getBalanceAgent() {
    let usdc = ERC20__factory.connect(this.token, this.agent);
    let balance = await usdc.balanceOf(this.agent.address);
    return Number(formatUnits(balance, this.tokenDecimal));
  }

  async doEveryThing() {
    await this.withdrawFromStrategyToAgent();

    let liquidity = await this.getBalanceVault();
    logger.debug(`liquidity: ${liquidity}`);
    if (liquidity < 1) return;

    let newPlan = await this.optimizeLiquidity(liquidity);
    console.log("plan", newPlan);

    for (let i = 0; i < newPlan.data.length; i++) {
      let strategy = newPlan.data[i].strategy;
      let availableLiquidity = newPlan.data[i].availableLiquidity;
      let liquidity = newPlan.data[i].liquidity;
      let minimumLiquidity = newPlan.data[i].minimumLiquidity;
      if (liquidity > availableLiquidity + minimumLiquidity) {
        let amountWithdraw = liquidity - availableLiquidity - minimumLiquidity;
        logger.debug(`withdraw from ${strategy.name} amount: ${amountWithdraw}`);
        await strategy.withdraw(amountWithdraw);
      }
    }

    let remainLiquidity = await this.getBalanceAgent();

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
        logger.debug(`deposit to strategy ${strategy.name} amount ${amountWithdraw}`);
        await strategy.deposit(amountWithdraw);
        remainLiquidity -= amountWithdraw;
      }
    }
  }
}
