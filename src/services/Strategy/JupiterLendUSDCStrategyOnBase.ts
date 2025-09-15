import { ethers, hexlify, JsonRpcProvider, MaxUint256, parseUnits, Wallet } from "ethers";
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

export class JupiterLendingUSDCOnBase implements StrategyInterface {
  name: string = "Jupiter Lending USDC On Base";
  apy: number = 0;
  tvl: number = 0;
  apyUpdateTimestamp: number = 0;
  tvlUpdateTimestamp: number = 0;
  minDebt: number = 0;
  maxDebt: number = 0;
  provider: JsonRpcProvider;
  wallet: Wallet;
  walletSolana: Keypair;
  // config
  token: string = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  tokenDecimals: number = 6;

  // across
  baseSpokePoolProxy: string = "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64";

  // usdc On Solana
  tokenOnSolana: string = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  tokenOnSolanaDecimals: number = 6;

  constructor(privateKey: string, privateKeySolana: string, minDebt: number = 0, maxDebt: number = 1_000_000) {
    this.minDebt = minDebt;
    this.maxDebt = maxDebt;
    this.provider = new JsonRpcProvider(RPC_URL_BASE);
    this.wallet = new Wallet(privateKey, this.provider);
    this.walletSolana = Keypair.fromSecretKey(bs58.decode(privateKeySolana));
  }

  getName(): string {
    return this.name;
  }

  async getAPY(): Promise<number> {
    let now = getTimestampNow();
    if (this.apyUpdateTimestamp < now - 300) {
      this.apy = 8.37; // todo write script crawl data
      this.apyUpdateTimestamp = now;
    }
    return this.apy;
  }

  async getTVL(): Promise<number> {
    let now = getTimestampNow();
    if (this.tvlUpdateTimestamp < now - 300) {
      this.tvl = 303_000_000; // todo write script crawl data
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
    return 0; // todo crawl balance
  }

  async getMinimumLiquidity(): Promise<number> {
    return this.minDebt;
  }

  async deposit(amount: number): Promise<void> {
    // bridge through across
    await this.bridgeToSolana(amount);
    await this.depositAllToJupiter();
    // deposit to jup lend
  }

  async withdraw(amount: number): Promise<void> {
    // withdraw from jup lend
    // bridge throudh across
    let amountWithdrawn = await this.withdrawFromJupiter(amount);
    await this.bridgeToBase(amountWithdrawn);
  }

  async suggestedFeesFromBaseToSolana(amountBigInt: bigint) {
    const { data } = await axios.get("https://app.across.to/api/suggested-fees", {
      params: {
        inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        outputToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        originChainId: 8453,
        destinationChainId: 34268394551451,
        recipient: this.walletSolana.publicKey,
        amount: amountBigInt,
      },
    });
    return data;
  }

  async suggestedFeesFromSolanaToBase(amountBigInt: BigInt) {
    try {
      const { data } = await axios.get("https://app.across.to/api/suggested-fees", {
        params: {
          inputToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          outputToken: this.token,
          originChainId: 34268394551451,
          destinationChainId: 8453,
          recipient: this.wallet.address,
          amount: amountBigInt,
        },
      });
      return data;
    } catch (e) {
      console.log(e);
      throw new Error(" Error when get suggested fees from solana to base " + e);
    }
  }

  async bridgeToBase(amountBigInt: BigInt) {
    try {
      let data = await this.suggestedFeesFromSolanaToBase(amountBigInt);
      console.log(data);
      logger.info(`${this.name}: estimate time bridge ${data.estimatedFillTimeSec} seconds`);
      let connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
      let walletAnchor = new WalletAnchor(this.walletSolana);
      const provider = new AnchorProvider(connection, walletAnchor, { commitment: "confirmed" });
      const programId = new PublicKey(SvmSpokeIdl.address);

      const program = new Program(SvmSpokeIdl, provider);

      let depositorTokenAccount = getAssociatedTokenAddressSync(new PublicKey(this.tokenOnSolana), this.walletSolana.publicKey);
      const inputToken = new PublicKey(data.inputToken.address);
      const seed = 0;

      const u64Encoder = getU64Encoder();
      const [statePda] = PublicKey.findProgramAddressSync([Buffer.from("state"), Buffer.from(u64Encoder.encode(seed))], programId);
      const [vaultPda] = PublicKey.findProgramAddressSync([statePda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), inputToken.toBuffer()], programId);
      const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], programId);

      const depositor = this.walletSolana.publicKey;
      const recepitor = this.evmToSolanaPK(this.wallet.address);
      const outputToken = this.evmToSolanaPK(data.outputToken.address);
      const exclusiveRelayer = this.evmToSolanaPK(data.exclusiveRelayer);

      const inputAmount = new BN(amountBigInt.toString());
      const outputAmount = intToU8Array32(new BN(data.outputAmount));

      const destinationChainId = new BN(data.outputToken.chainId);
      const quoteTimestamp = new BN(Math.floor(Date.now() / 1000) - 60);
      const fillDeadline = new BN(Math.floor(Date.now() / 1000) + 600); // u32;
      const exclusivityDeadline = new BN(0);
      const exclusivityParameter = data.exclusivityParameter >>> 0; // u32
      const message = Buffer.from("");

      let depositData = {
        depositor: depositor,
        recipient: recepitor,
        inputToken: inputToken,
        outputToken: outputToken,
        inputAmount: inputAmount,
        outputAmount: outputAmount,
        destinationChainId: destinationChainId,
        exclusiveRelayer: exclusiveRelayer,
        quoteTimestamp: quoteTimestamp,
        fillDeadline: fillDeadline,
        exclusivityParameter: new BN(0),
        message: message,
      };

      const delegate = getDepositPda(depositData, programId);
      console.log("Depositing...");
      // console.table([
      //   { property: "seed", value: seed.toString() },
      //   { property: "depositor", value: depositor.toString() },
      //   { property: "recipient", value: recepitor.toString() },
      //   { property: "inputToken", value: inputToken.toString() },
      //   { property: "outputToken", value: outputToken.toString() },
      //   { property: "inputAmount", value: inputAmount.toString() },
      //   { property: "outputAmount", value: u8Array32ToInt(outputAmount).toString() },
      //   { property: "destinationChainId", value: destinationChainId.toString() },
      //   { property: "exclusiveRelayer", value: exclusiveRelayer.toString() },
      //   { property: "quoteTimestamp", value: quoteTimestamp.toString() },
      //   { property: "fillDeadline", value: fillDeadline.toString() },
      //   { property: "exclusivityDeadline", value: exclusivityDeadline.toString() },
      //   { property: "message", value: message.toString() },
      //   { property: "programId", value: programId.toString() },
      //   { property: "#1 signer", value: provider.wallet.publicKey.toString() },
      //   { property: "#2 state", value: statePda.toString() },
      //   { property: "#3 delegate", value: delegate.toString() },
      //   { property: "#4 depositorTokenAccount", value: depositorTokenAccount.toString() },
      //   { property: "#5 vault", value: vaultPda.toString() },
      //   { property: "#6 mint", value: inputToken.toString() },
      //   { property: "#7 tokenProgram", value: TOKEN_PROGRAM_ID.toString() },
      //   { property: "#8 associatedTokenProgram", value: ASSOCIATED_TOKEN_PROGRAM_ID.toString() },
      //   { property: "#9 systemProgram", value: SystemProgram.programId.toString() },
      //   { property: "#10 eventAuthority", value: eventAuthority.toString() },
      //   { property: "#11 program", value: program.programId.toString() },
      // ]);

      const approveTx = createApproveCheckedInstruction(depositorTokenAccount, inputToken, delegate, depositor, BigInt(inputAmount.toString()), 6, undefined, TOKEN_PROGRAM_ID);

      const txSig = await program.methods
        .deposit(depositor, recepitor, inputToken, outputToken, inputAmount, outputAmount, destinationChainId, exclusiveRelayer, quoteTimestamp, fillDeadline, new BN(0), message)
        .accounts({
          signer: provider.wallet.publicKey,
          state: statePda,
          delegate: delegate,
          depositorTokenAccount: depositorTokenAccount,
          vault: new PublicKey("HYhZwefNFmEm9sXYKkNM4QPMgGQnS9VjC6kgxwrGk3Ru"),
          mint: inputToken,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          eventAuthority,
          program: program.programId,
        })
        .instruction();

      let depositTx = new Transaction().add(approveTx, txSig);
      let receipt = await sendAndConfirmTransaction(connection, depositTx, [this.walletSolana]);
      logger.info(`${this.name}: bridge success `);
      await sleep(10000);
      await this.checkBridgeFilled(receipt);
      logger.info(`${this.name}: check bridge filled success`);
    } catch (e) {
      console.log(e);
      throw new Error(" Error when bridge to base " + e);
    }
  }

  private async bridgeToSolana(amount: number) {
    let amountBigInt = parseUnits(amount.toFixed(this.tokenDecimals), this.tokenDecimals);
    let acrossSpokePoolProxyContract = AcrossSpokePoolProxy__factory.connect(this.baseSpokePoolProxy, this.wallet);
    let data = await this.suggestedFeesFromBaseToSolana(amountBigInt);
    logger.info(`${this.name}: estimate time bridge ${data.estimatedFillTimeSec} seconds`);
    let depositor = ethers.zeroPadValue(this.wallet.address, 32);
    let recipient = hexlify(this.walletSolana.publicKey.toBytes());
    let inputToken = ethers.zeroPadValue(this.token, 32);
    let outputToken = hexlify(new PublicKey(this.tokenOnSolana).toBytes());
    let inputAmount = amountBigInt;
    let outputAmount = data.outputAmount;
    let destinationChainId = 34268394551451n; // solana chain id in across
    let exclusiveRelayer = ethers.zeroPadValue(data.exclusiveRelayer, 32);
    let timestamp = data.timestamp;
    let fillDeadline = data.fillDeadline;
    let exclusivityParameter = 0;
    let message = "";
    let usdcContract = ERC20__factory.connect(this.token, this.provider);
    let allownace = await usdcContract.allowance(this.wallet.address, this.baseSpokePoolProxy);
    if (allownace < amountBigInt) {
      let txApprove = await usdcContract.approve(this.baseSpokePoolProxy, amountBigInt);
      let receiptApprove = await txApprove.wait();
      logger.info(`${this.name}: approve success ${receiptApprove?.hash}`);
    }
    logger.info(`${this.name}: depositing amount: ${amount}`);
    try {
      let tx = await acrossSpokePoolProxyContract.deposit(
        depositor,
        recipient,
        inputToken,
        outputToken,
        inputAmount,
        outputAmount,
        destinationChainId,
        exclusiveRelayer,
        timestamp,
        fillDeadline,
        exclusivityParameter,
        "0x"
      );
      let receipt = await tx.wait();
      logger.info(`${this.name}: deposit success ${receipt?.hash}`);
      await sleep(10000);
      let receipt2 = await this.checkBridgeFilled(receipt!.hash);
      logger.info(`${this.name}: check bridge filled success`);
    } catch (e) {
      console.log(" error deposit ", e);
    }
  }

  async checkBridgeFilled(transactionHash: string) {
    let maxDuration = 30000;
    let totalDuration = 0;
    return new Promise((resolve, reject) => {
      const intervalValue = 2000;
      const intervalId = setInterval(async () => {
        try {
          let depositInfo = await this.getDepositInfo(transactionHash);
          if (depositInfo.status === "filled") {
            clearInterval(intervalId);
            resolve(depositInfo);
          }
        } catch (e) {
          console.log(e);
          clearInterval(intervalId);
          reject(new Error("Error get deposit info"));
        }
        totalDuration += intervalValue;
        if (totalDuration > maxDuration) {
          clearInterval(intervalId);
          reject(new Error("Max duration reached"));
        }
      }, intervalValue);
    });
  }

  async withdrawFromJupiter(amount: number) {
    let balancePre = await this.getBalanceUSDCInWalletOnSolana();
    let amountbigInt = parseUnits(amount.toFixed(6), 6);
    let withdrawData = await this.getWithdrawTransaction(amountbigInt);
    let connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

    let txBuffer = Buffer.from(withdrawData.transaction, "base64");
    let transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([this.walletSolana]);
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false, // Run preflight checks to catch errors early
      maxRetries: 3,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "finalized");
    logger.info(`${this.name}: withdraw success ${signature}`);
    let balancePost = await this.getBalanceUSDCInWalletOnSolana();
    let amountWithdrawn = balancePost - balancePre;
    logger.info(`${this.name}: withdraw amount ${amountWithdrawn}`);
    return amountWithdrawn;
  }

  async depositAllToJupiter() {
    const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
    let amountUSD = await this.getBalanceUSDCInWalletOnSolana();
    let data = await this.getDepositTransaction(amountUSD);
    let txBuffer = Buffer.from(data.transaction, "base64");
    let transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([this.walletSolana]);
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false, // Run preflight checks to catch errors early
      maxRetries: 3,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "finalized");
    logger.info(`${this.name}: deposit success ${signature}`);
  }

  private async getBalanceUSDCInWalletOnSolana() {
    const USDC_MINT_MAINNET = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
    const owner = this.walletSolana.publicKey;
    const resp = await connection.getTokenAccountsByOwner(owner, { mint: USDC_MINT_MAINNET }, { commitment: "confirmed" });
    let ata = await getAssociatedTokenAddress(new PublicKey(this.tokenOnSolana), this.walletSolana.publicKey);
    let bal = await connection.getTokenAccountBalance(ata);
    return BigInt(bal.value.amount);
  }
  // brdige
  async getDepositInfo(transactionHash: string, log: boolean = false) {
    let { data } = await axios.get(`https://app.across.to/api/deposit/status`, {
      params: {
        depositTxHash: transactionHash,
      },
    });
    if (log) {
      console.log(data);
    }
    return data;
  }

  async getDepositTransaction(amount: bigint) {
    try {
      const { data } = await axios.post(
        "https://lite-api.jup.ag/lend/v1/earn/deposit",
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
    } catch (e) {
      console.log(e);
      throw new Error(" Error when get deposit transaction " + e);
    }
  }

  async getWithdrawTransaction(amount: bigint) {
    try {
      const { data } = await axios.post(
        "https://lite-api.jup.ag/lend/v1/earn/withdraw",
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
    } catch (e) {
      console.log(e);
      throw new Error(" Error when get withdraw transaction " + e);
    }
  }

  evmToSolanaPK(evmAddress: string) {
    const hex = evmAddress.replace(/^0x/, "").toLowerCase();
    if (hex.length !== 40) throw new Error("Invalid EVM address");

    const buf = Buffer.alloc(32);
    Buffer.from(hex, "hex").copy(buf, 12); // right-align, zero-pad left 12 bytes
    return new PublicKey(buf);
  }

  async test() {}
}
