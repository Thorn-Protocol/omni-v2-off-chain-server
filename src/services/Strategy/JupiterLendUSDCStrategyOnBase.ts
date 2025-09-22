import { ethers, hexlify, JsonRpcProvider, parseUnits, Wallet } from "ethers";
import StrategyInterface, { GetLiquidityAvailableAtAPYResponse } from "../../interfaces/StrategyInterface";
import { getTimestampNow, sleep } from "../../utils/helper";
import { RPC_URL_BASE } from "../../common/config/secrets";
import { AcrossSpokePoolProxy__factory } from "../../typechain-types";
import axios from "axios";
import { clusterApiUrl, Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import logger from "../../lib/winston";
import { ERC20__factory } from "../../typechain-types/factories/ERC20__factory";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createApproveCheckedInstruction, getAssociatedTokenAddress, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getU64Encoder } from "@solana/kit";
import { SvmSpokeIdl } from "@across-protocol/contracts";
import BN from "bn.js";
import { AnchorProvider, Program, Wallet as WalletAnchor } from "@coral-xyz/anchor";
import { getDepositPda, intToU8Array32 } from "@across-protocol/contracts/dist/src/svm/web3-v1";
import { MIN_DEPOSIT_WITHDRAW } from "../../common/config/config";

// Constants
const APY_CACHE_DURATION = 300; // 5 minutes
const TVL_CACHE_DURATION = 300; // 5 minutes
const BRIDGE_CHECK_INTERVAL = 2000; // 2 seconds
const BRIDGE_MAX_DURATION = 30000; // 30 seconds
const BRIDGE_WAIT_TIME = 10000; // 10 seconds
const BASE_CHAIN_ID = 8453;
const SOLANA_CHAIN_ID = 34268394551451;
const USDC_DECIMALS = 6;
const DEFAULT_EXCLUSIVITY_PARAMETER = 0;
const QUOTE_TIMESTAMP_OFFSET = 60; // 1 minute
const FILL_DEADLINE_OFFSET = 600; // 10 minutes

// Token addresses
const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SOLANA_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_SPOKE_POOL_PROXY = "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64";
const SOLANA_VAULT_ADDRESS = "HYhZwefNFmEm9sXYKkNM4QPMgGQnS9VjC6kgxwrGk3Ru";

// API endpoints
const ACROSS_API_BASE = "https://app.across.to/api";
const JUPITER_API_BASE = "https://lite-api.jup.ag/lend/v1";

// Interfaces
interface SuggestedFeesResponse {
  inputToken: { address: string };
  outputToken: { address: string; chainId: number };
  outputAmount: string;
  exclusiveRelayer: string;
  estimatedFillTimeSec: number;
  timestamp: number;
  fillDeadline: number;
  exclusivityParameter: number;
}

interface DepositInfoResponse {
  status: string;
}

interface JupiterPosition {
  token: {
    symbol: string;
    totalAssets: string;
    totalRate: number;
  };
  underlyingAssets: string;
}

interface JupiterTransactionResponse {
  transaction: string;
}

export class JupiterLendingUSDCOnBase implements StrategyInterface {
  public readonly name: string = "Jupiter Lending USDC On Base";
  private apy: number = 0;
  private tvl: number = 0;
  private apyUpdateTimestamp: number = 0;
  private tvlUpdateTimestamp: number = 0;
  private readonly minDebt: number;
  private readonly maxDebt: number;
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly walletSolana: Keypair;
  private readonly token: string = USDC_BASE_ADDRESS;
  private readonly tokenDecimals: number = USDC_DECIMALS;
  private readonly baseSpokePoolProxy: string = BASE_SPOKE_POOL_PROXY;
  private readonly tokenOnSolana: string = USDC_SOLANA_ADDRESS;
  private readonly tokenOnSolanaDecimals: number = USDC_DECIMALS;

  /**
   * Constructor for Jupiter Lending USDC Strategy on Base
   * @param privateKey - EVM private key for Base network operations
   * @param privateKeySolana - Solana private key for Solana network operations
   * @param minDebt - Minimum debt threshold for operations
   * @param maxDebt - Maximum debt threshold for operations
   */
  constructor(privateKey: string, privateKeySolana: string, minDebt: number = 0, maxDebt: number = 1_000_000) {
    this.minDebt = minDebt;
    this.maxDebt = maxDebt;
    this.provider = new JsonRpcProvider(RPC_URL_BASE);
    this.wallet = new Wallet(privateKey, this.provider);
    this.walletSolana = Keypair.fromSecretKey(bs58.decode(privateKeySolana));
    logger.info(`${this.name}: Constructor initialized with Solana agent: ${this.walletSolana.publicKey}`);
  }

  /**
   * Get the strategy name
   * @returns The strategy name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get the current APY (Annual Percentage Yield) with caching
   * @returns The current APY as a decimal number
   */
  async getAPY(): Promise<number> {
    const now = getTimestampNow();
    if (this.apyUpdateTimestamp < now - APY_CACHE_DURATION) {
      await this.updateData();
      this.apyUpdateTimestamp = now;
    }
    return this.apy;
  }

  /**
   * Get the current TVL (Total Value Locked) with caching
   * @returns The current TVL as a number
   */
  async getTVL(): Promise<number> {
    const now = getTimestampNow();
    if (this.tvlUpdateTimestamp < now - TVL_CACHE_DURATION) {
      await this.updateData();
      this.tvlUpdateTimestamp = now;
    }
    return this.tvl;
  }

  /**
   * Calculate available liquidity at a target APY
   * @param targetAPY - The target APY to calculate liquidity for
   * @returns Object containing available liquidity information
   */
  async getLiquidityAvailableAtAPY(targetAPY: number): Promise<GetLiquidityAvailableAtAPYResponse> {
    const tvl = await this.getTVL();
    const apy = await this.getAPY();
    const reward = tvl * apy;
    const requiredTVL = reward / targetAPY;
    const deltaLiquidity = requiredTVL - tvl;
    return {
      availableLiquidity: Math.max(0, Math.min(deltaLiquidity, this.maxDebt)),
    };
  }

  /**
   * Get the current balance in USDC
   * @returns The current balance as a number
   */
  async getBalance(): Promise<number> {
    return Number(ethers.formatUnits(await this.getPositions(), this.tokenOnSolanaDecimals));
  }

  /**
   * Get the minimum liquidity threshold
   * @returns The minimum liquidity amount
   */
  async getMinimumLiquidity(): Promise<number> {
    return this.minDebt;
  }

  /**
   * Deposit USDC to Jupiter Lending strategy
   * Bridges USDC from Base to Solana and deposits to Jupiter Lending
   * @param amount - Amount of USDC to deposit
   */
  async deposit(amount: number): Promise<void> {
    if (amount < MIN_DEPOSIT_WITHDRAW) {
      logger.info(`${this.name}: Amount ${amount} is less than minimum required ${MIN_DEPOSIT_WITHDRAW}, skipping deposit`);
      return;
    }

    try {
      logger.info(`${this.name}: Starting deposit process for amount: ${amount}`);
      await this.bridgeToSolana(amount);
      await this.depositAllToJupiter();
      logger.info(`${this.name}: Deposit process completed successfully`);
    } catch (error) {
      logger.error(`${this.name}: Error during deposit process:`, error);
      throw new Error(`Deposit failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Withdraw USDC from Jupiter Lending strategy
   * Withdraws from Jupiter Lending and bridges USDC back to Base
   * @param amount - Amount of USDC to withdraw
   */
  async withdraw(amount: number): Promise<void> {
    if (amount < MIN_DEPOSIT_WITHDRAW) {
      logger.info(`${this.name}: Amount ${amount} is less than minimum required ${MIN_DEPOSIT_WITHDRAW}, skipping withdraw`);
      return;
    }

    try {
      logger.info(`${this.name}: Starting withdraw process for amount: ${amount}`);
      const amountWithdrawn = await this.withdrawFromJupiter(amount);
      await this.bridgeToBase(BigInt(amountWithdrawn));
      logger.info(`${this.name}: Withdraw process completed successfully`);
    } catch (error) {
      logger.error(`${this.name}: Error during withdraw process:`, error);
      throw new Error(`Withdraw failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get suggested fees for bridging from Base to Solana
   * @param amountBigInt - Amount to bridge in BigInt format
   * @returns Suggested fees response from Across API
   */
  private async suggestedFeesFromBaseToSolana(amountBigInt: bigint): Promise<SuggestedFeesResponse> {
    try {
      const { data } = await axios.get(`${ACROSS_API_BASE}/suggested-fees`, {
        params: {
          inputToken: USDC_BASE_ADDRESS,
          outputToken: USDC_SOLANA_ADDRESS,
          originChainId: BASE_CHAIN_ID,
          destinationChainId: SOLANA_CHAIN_ID,
          recipient: this.walletSolana.publicKey,
          amount: amountBigInt,
        },
      });
      return data;
    } catch (error) {
      logger.error(`${this.name}: Error getting suggested fees from Base to Solana:`, error);
      throw new Error(`Failed to get suggested fees from Base to Solana: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get suggested fees for bridging from Solana to Base
   * @param amountBigInt - Amount to bridge in BigInt format
   * @returns Suggested fees response from Across API
   */
  private async suggestedFeesFromSolanaToBase(amountBigInt: bigint): Promise<SuggestedFeesResponse> {
    try {
      const { data } = await axios.get(`${ACROSS_API_BASE}/suggested-fees`, {
        params: {
          inputToken: USDC_SOLANA_ADDRESS,
          outputToken: this.token,
          originChainId: SOLANA_CHAIN_ID,
          destinationChainId: BASE_CHAIN_ID,
          recipient: this.wallet.address,
          amount: amountBigInt,
        },
      });
      return data;
    } catch (error) {
      logger.error(`${this.name}: Error getting suggested fees from Solana to Base:`, error);
      throw new Error(`Failed to get suggested fees from Solana to Base: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Bridge USDC from Solana back to Base network using Across protocol
   * @param amountBigInt - Amount to bridge in BigInt format
   */
  private async bridgeToBase(amountBigInt: bigint): Promise<void> {
    try {
      const feesData = await this.suggestedFeesFromSolanaToBase(amountBigInt);
      logger.info(`${this.name}: Estimated bridge time: ${feesData.estimatedFillTimeSec} seconds`);

      const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
      const program = await this.createAnchorProgram(connection);

      const depositData = this.createDepositData(feesData, amountBigInt);
      const accounts = this.createDepositAccounts(depositData, program.programId);

      const transaction = await this.createDepositTransaction(program, depositData, accounts);
      const signature = await sendAndConfirmTransaction(connection, transaction, [this.walletSolana]);

      logger.info(`${this.name}: Bridge transaction successful: ${signature}`);
      await sleep(BRIDGE_WAIT_TIME);
      await this.checkBridgeFilled(signature);
      logger.info(`${this.name}: Bridge filled successfully`);
    } catch (error) {
      logger.error(`${this.name}: Error bridging to Base:`, error);
      throw new Error(`Bridge to Base failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Create Anchor program instance for Solana operations
   * @param connection - Solana connection instance
   * @returns Anchor program instance
   */
  private async createAnchorProgram(connection: Connection): Promise<Program> {
    const walletAnchor = new WalletAnchor(this.walletSolana);
    const provider = new AnchorProvider(connection, walletAnchor, { commitment: "confirmed" });
    const programId = new PublicKey(SvmSpokeIdl.address);
    return new Program(SvmSpokeIdl, provider);
  }

  /**
   * Create deposit data for Across bridge transaction
   * @param feesData - Suggested fees data from Across API
   * @param amountBigInt - Amount to bridge in BigInt format
   * @returns Deposit data object for Across bridge
   */
  private createDepositData(feesData: SuggestedFeesResponse, amountBigInt: bigint) {
    const inputToken = new PublicKey(feesData.inputToken.address);
    const outputToken = this.evmToSolanaPK(feesData.outputToken.address);
    const exclusiveRelayer = this.evmToSolanaPK(feesData.exclusiveRelayer);

    const inputAmount = new BN(amountBigInt.toString());
    const outputAmount = intToU8Array32(new BN(feesData.outputAmount));
    const destinationChainId = new BN(feesData.outputToken.chainId);
    const quoteTimestamp = new BN(Math.floor(Date.now() / 1000) - QUOTE_TIMESTAMP_OFFSET);
    const fillDeadline = new BN(Math.floor(Date.now() / 1000) + FILL_DEADLINE_OFFSET);

    return {
      depositor: this.walletSolana.publicKey,
      recipient: this.evmToSolanaPK(this.wallet.address),
      inputToken,
      outputToken,
      inputAmount,
      outputAmount,
      destinationChainId,
      exclusiveRelayer,
      quoteTimestamp,
      fillDeadline,
      exclusivityParameter: new BN(DEFAULT_EXCLUSIVITY_PARAMETER),
      message: Buffer.from(""),
    };
  }

  /**
   * Create deposit accounts for Across bridge transaction
   * @param depositData - Deposit data object
   * @param programId - Solana program ID
   * @returns Accounts object for the transaction
   */
  private createDepositAccounts(depositData: any, programId: PublicKey) {
    const u64Encoder = getU64Encoder();
    const seed = 0;

    const [statePda] = PublicKey.findProgramAddressSync([Buffer.from("state"), Buffer.from(u64Encoder.encode(seed))], programId);

    const [vaultPda] = PublicKey.findProgramAddressSync([statePda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), depositData.inputToken.toBuffer()], programId);

    const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], programId);

    const depositorTokenAccount = getAssociatedTokenAddressSync(new PublicKey(this.tokenOnSolana), this.walletSolana.publicKey);

    const delegate = getDepositPda(depositData, programId);

    return {
      signer: this.walletSolana.publicKey,
      state: statePda,
      delegate,
      depositorTokenAccount,
      vault: new PublicKey(SOLANA_VAULT_ADDRESS),
      mint: depositData.inputToken,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority,
      program: programId,
    };
  }

  /**
   * Create the complete deposit transaction for Across bridge
   * @param program - Anchor program instance
   * @param depositData - Deposit data object
   * @param accounts - Accounts object for the transaction
   * @returns Complete transaction ready to be sent
   */
  private async createDepositTransaction(program: Program, depositData: any, accounts: any): Promise<Transaction> {
    const approveTx = createApproveCheckedInstruction(
      accounts.depositorTokenAccount,
      depositData.inputToken,
      accounts.delegate,
      depositData.depositor,
      BigInt(depositData.inputAmount.toString()),
      USDC_DECIMALS,
      undefined,
      TOKEN_PROGRAM_ID
    );

    const depositInstruction = await program.methods
      .deposit(
        depositData.depositor,
        depositData.recipient,
        depositData.inputToken,
        depositData.outputToken,
        depositData.inputAmount,
        depositData.outputAmount,
        depositData.destinationChainId,
        depositData.exclusiveRelayer,
        depositData.quoteTimestamp,
        depositData.fillDeadline,
        depositData.exclusivityParameter,
        depositData.message
      )
      .accounts(accounts)
      .instruction();

    return new Transaction().add(approveTx, depositInstruction);
  }

  /**
   * Bridge USDC from Base to Solana network using Across protocol
   * @param amount - Amount of USDC to bridge
   */
  private async bridgeToSolana(amount: number): Promise<void> {
    try {
      const amountBigInt = parseUnits(amount.toFixed(this.tokenDecimals), this.tokenDecimals);
      const acrossSpokePoolProxyContract = AcrossSpokePoolProxy__factory.connect(this.baseSpokePoolProxy, this.wallet);
      const feesData = await this.suggestedFeesFromBaseToSolana(amountBigInt);

      logger.info(`${this.name}: Estimated bridge time: ${feesData.estimatedFillTimeSec} seconds`);

      // Prepare deposit parameters
      const depositor = ethers.zeroPadValue(this.wallet.address, 32);
      const recipient = hexlify(this.walletSolana.publicKey.toBytes());
      const inputToken = ethers.zeroPadValue(this.token, 32);
      const outputToken = hexlify(new PublicKey(this.tokenOnSolana).toBytes());
      const destinationChainId = BigInt(SOLANA_CHAIN_ID);
      const exclusiveRelayer = ethers.zeroPadValue(feesData.exclusiveRelayer, 32);

      // Check and approve USDC if needed
      await this.ensureUSDCApproval(amountBigInt);

      logger.info(`${this.name}: Depositing amount: ${amount}`);

      const tx = await acrossSpokePoolProxyContract.deposit(
        depositor,
        recipient,
        inputToken,
        outputToken,
        amountBigInt,
        feesData.outputAmount,
        destinationChainId,
        exclusiveRelayer,
        feesData.timestamp,
        feesData.fillDeadline,
        DEFAULT_EXCLUSIVITY_PARAMETER,
        "0x"
      );

      const receipt = await tx.wait();
      logger.info(`${this.name}: Deposit transaction successful: ${receipt?.hash}`);

      await sleep(BRIDGE_WAIT_TIME);
      await this.checkBridgeFilled(receipt!.hash);
      logger.info(`${this.name}: Bridge filled successfully`);
    } catch (error) {
      logger.error(`${this.name}: Error bridging to Solana:`, error);
      throw new Error(`Bridge to Solana failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Ensure USDC is approved for the bridge contract
   * @param amountBigInt - Amount to approve in BigInt format
   */
  private async ensureUSDCApproval(amountBigInt: bigint): Promise<void> {
    const usdcContract = ERC20__factory.connect(this.token, this.wallet);
    const allowance = await usdcContract.allowance(this.wallet.address, this.baseSpokePoolProxy);

    if (allowance < amountBigInt) {
      logger.info(`${this.name}: Approving USDC for bridge contract`);
      const txApprove = await usdcContract.approve(this.baseSpokePoolProxy, amountBigInt);
      const receiptApprove = await txApprove.wait();
      logger.info(`${this.name}: USDC approval successful: ${receiptApprove?.hash}`);
    }
  }

  /**
   * Check if bridge transaction has been filled
   * @param transactionHash - Transaction hash to check
   * @returns Promise that resolves when bridge is filled
   */
  private async checkBridgeFilled(transactionHash: string): Promise<DepositInfoResponse> {
    return new Promise((resolve, reject) => {
      let totalDuration = 0;
      const intervalId = setInterval(async () => {
        try {
          const depositInfo = await this.getDepositInfo(transactionHash);
          if (depositInfo.status === "filled") {
            clearInterval(intervalId);
            resolve(depositInfo);
          }
        } catch (error) {
          logger.error(`${this.name}: Error checking bridge status:`, error);
          clearInterval(intervalId);
          reject(new Error("Failed to get deposit info"));
        }

        totalDuration += BRIDGE_CHECK_INTERVAL;
        if (totalDuration > BRIDGE_MAX_DURATION) {
          clearInterval(intervalId);
          reject(new Error("Bridge check timeout - maximum duration reached"));
        }
      }, BRIDGE_CHECK_INTERVAL);
    });
  }

  /**
   * Withdraw USDC from Jupiter Lending
   * @param amount - Amount of USDC to withdraw
   * @returns Actual amount withdrawn
   */
  private async withdrawFromJupiter(amount: number): Promise<number> {
    try {
      const balancePre = await this.getBalanceUSDCInWalletOnSolana();
      const amountBigInt = parseUnits(amount.toFixed(USDC_DECIMALS), USDC_DECIMALS);
      const withdrawData = await this.getWithdrawTransaction(amountBigInt);
      const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

      const txBuffer = Buffer.from(withdrawData.transaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBuffer);
      transaction.sign([this.walletSolana]);

      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });

      await connection.confirmTransaction(signature, "finalized");
      logger.info(`${this.name}: Withdraw transaction successful: ${signature}`);

      const balancePost = await this.getBalanceUSDCInWalletOnSolana();
      const amountWithdrawn = Number(balancePost - balancePre);
      logger.info(`${this.name}: Withdrawn amount: ${amountWithdrawn}`);

      return amountWithdrawn;
    } catch (error) {
      logger.error(`${this.name}: Error withdrawing from Jupiter:`, error);
      throw new Error(`Jupiter withdraw failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Deposit all available USDC to Jupiter Lending
   */
  private async depositAllToJupiter(): Promise<void> {
    try {
      const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
      const amountUSD = await this.getBalanceUSDCInWalletOnSolana();
      const depositData = await this.getDepositTransaction(amountUSD);

      const txBuffer = Buffer.from(depositData.transaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBuffer);
      transaction.sign([this.walletSolana]);

      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });

      await connection.confirmTransaction(signature, "finalized");
      logger.info(`${this.name}: Deposit transaction successful: ${signature}`);
    } catch (error) {
      logger.error(`${this.name}: Error depositing to Jupiter:`, error);
      throw new Error(`Jupiter deposit failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get USDC balance in wallet on Solana
   * @returns USDC balance in BigInt format
   */
  private async getBalanceUSDCInWalletOnSolana(): Promise<bigint> {
    try {
      const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
      const ata = await getAssociatedTokenAddress(new PublicKey(this.tokenOnSolana), this.walletSolana.publicKey);
      const balance = await connection.getTokenAccountBalance(ata);
      return BigInt(balance.value.amount);
    } catch (error) {
      logger.error(`${this.name}: Error getting USDC balance on Solana:`, error);
      throw new Error(`Failed to get USDC balance: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get deposit information from Across API
   * @param transactionHash - Transaction hash to check
   * @returns Deposit information response
   */
  private async getDepositInfo(transactionHash: string): Promise<DepositInfoResponse> {
    try {
      const { data } = await axios.get(`${ACROSS_API_BASE}/deposit/status`, {
        params: {
          depositTxHash: transactionHash,
        },
      });
      return data;
    } catch (error) {
      logger.error(`${this.name}: Error getting deposit info:`, error);
      throw new Error(`Failed to get deposit info: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get current positions from Jupiter Lending
   * @returns Current position amount in BigInt format
   */
  private async getPositions(): Promise<bigint> {
    try {
      const { data } = await axios.get(`${JUPITER_API_BASE}/earn/positions`, {
        params: {
          users: [this.walletSolana.publicKey],
        },
      });

      const jlUSDCData = data.find((item: JupiterPosition) => item.token.symbol === "jlUSDC");
      return jlUSDCData ? BigInt(jlUSDCData.underlyingAssets) : BigInt(0);
    } catch (error) {
      logger.error(`${this.name}: Error getting positions:`, error);
      throw new Error(`Failed to get positions: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get deposit transaction from Jupiter API
   * @param amount - Amount to deposit in BigInt format
   * @returns Jupiter transaction response
   */
  private async getDepositTransaction(amount: bigint): Promise<JupiterTransactionResponse> {
    try {
      const { data } = await axios.post(
        `${JUPITER_API_BASE}/earn/deposit`,
        {
          asset: this.tokenOnSolana,
          amount: amount.toString(),
          signer: this.walletSolana.publicKey,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      return data;
    } catch (error) {
      logger.error(`${this.name}: Error getting deposit transaction:`, error);
      throw new Error(`Failed to get deposit transaction: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get withdraw transaction from Jupiter API
   * @param amount - Amount to withdraw in BigInt format
   * @returns Jupiter transaction response
   */
  private async getWithdrawTransaction(amount: bigint): Promise<JupiterTransactionResponse> {
    try {
      const { data } = await axios.post(
        `${JUPITER_API_BASE}/earn/withdraw`,
        {
          asset: this.tokenOnSolana,
          amount: amount.toString(),
          signer: this.walletSolana.publicKey,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      return data;
    } catch (error) {
      logger.error(`${this.name}: Error getting withdraw transaction:`, error);
      throw new Error(`Failed to get withdraw transaction: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Convert EVM address to Solana PublicKey
   * @param evmAddress - EVM address to convert
   * @returns Solana PublicKey
   */
  private evmToSolanaPK(evmAddress: string): PublicKey {
    const hex = evmAddress.replace(/^0x/, "").toLowerCase();
    if (hex.length !== 40) {
      throw new Error("Invalid EVM address");
    }

    const buf = Buffer.alloc(32);
    Buffer.from(hex, "hex").copy(buf, 12); // right-align, zero-pad left 12 bytes
    return new PublicKey(buf);
  }

  /**
   * Update strategy data (APY and TVL) from Jupiter API
   */
  private async updateData(): Promise<void> {
    try {
      const { data } = await axios.get(`${JUPITER_API_BASE}/earn/positions`, {
        params: {
          users: [this.walletSolana.publicKey],
        },
      });

      const jlUSDCData = data.find((item: JupiterPosition) => item.token.symbol === "jlUSDC");
      if (jlUSDCData) {
        this.tvl = Number(ethers.formatUnits(jlUSDCData.token.totalAssets, this.tokenOnSolanaDecimals));
        this.apy = Number(jlUSDCData.token.totalRate) / 100;
        this.apyUpdateTimestamp = getTimestampNow();
        this.tvlUpdateTimestamp = getTimestampNow();
      } else {
        logger.warn(`${this.name}: No jlUSDC position found`);
      }
    } catch (error) {
      logger.error(`${this.name}: Error updating data:`, error);
      throw new Error(`Failed to update data: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
