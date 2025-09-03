import { addresses } from "./common/config/config";
import { RPC_URL_BASE, TEST_V2_AGENT_KEY } from "./common/config/secrets";
import { AerodromeMsusdUsdcOnBaseStrategy } from "./services/Strategy/msUSD-USDC_Liquidity_Strategy";
import OffChainVault from "./services/Vault/OffChainVault";

async function main() {
  let test_vault = new OffChainVault(addresses.test_vault.offChainStrategy, TEST_V2_AGENT_KEY, RPC_URL_BASE, "offchain strategy for TEST Vault on BASE");
  let test_msUSD_USDC_liquidity_strategy = new AerodromeMsusdUsdcOnBaseStrategy(TEST_V2_AGENT_KEY, 0.1, 3);
  test_vault.addStrategy(test_msUSD_USDC_liquidity_strategy);
  await test_vault.doEveryThing();
}
main();
