// src/services/Vault/VaultV2Service.ts
import { JsonRpcProvider, Wallet } from "ethers";
import type { VaultV2 } from "../../typechain-types/VaultV2";
import { VaultV2__factory } from "../../typechain-types/factories/VaultV2__factory";
import logger from "../../lib/winston";
import { INTERVAL_TIME_REBALANCE } from "../../common/config/config";
import { Mutex } from "async-mutex";

export default class VaultV2Service {
  vault: VaultV2;
  agent: Wallet;
  mutex: Mutex;

  constructor(vaultAddress: string, agentKey: string, providerUrl: string) {
    const provider = new JsonRpcProvider(providerUrl);
    this.agent = new Wallet(agentKey, provider);
    this.vault = VaultV2__factory.connect(vaultAddress, this.agent);
    this.mutex = new Mutex();

    logger.info(
      `VaultV2Service: agent ${this.agent.address}, vault ${vaultAddress}`
    );
  }

  async processReport(strategyAddress: string) {
    try {
      const tx = await this.vault.processReport(strategyAddress);
      const receipt = await tx.wait();
      logger.info(
        `VaultV2 processReport success for ${strategyAddress}: ${receipt!.hash}`
      );
    } catch (e) {
      logger.error(`VaultV2 processReport error: ${e}`);
      throw e;
    }
  }

  async runProcessReports(strategyAddresses: string[]) {
    await this.mutex.runExclusive(async () => {
      for (const addr of strategyAddresses) {
        try {
          await this.processReport(addr);
        } catch (e) {
          logger.error(
            `runProcessReports: error when processing ${addr}: ${e}`
          );
        }
      }
    });
  }
}
