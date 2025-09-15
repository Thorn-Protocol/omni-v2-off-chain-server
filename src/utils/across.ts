import { serialize } from "borsh";
import { ethers, keccak256 } from "ethers";
import { BigNumber } from "@ethersproject/bignumber";
import { PublicKey } from "@solana/web3.js";
function getSolanaChainId(cluster: any) {
  return BigNumber.from(BigInt(keccak256(ethers.toUtf8Bytes(`solana-${cluster}`))) & BigInt("0xFFFFFFFFFFFF"));
}

function deriveSeedHash(schema: any, seedObj: any) {
  const serialized = serialize(schema, seedObj);
  const hashHex = keccak256(serialized);
  return Buffer.from(hashHex.slice(2), "hex");
}

class DepositSeedData {
  constructor(fields: any) {
    Object.assign(this, fields);
  }
}

const depositSeedSchema = new Map([
  [
    DepositSeedData,
    {
      kind: "struct",
      fields: [
        ["depositor", [32]],
        ["recipient", [32]],
        ["inputToken", [32]],
        ["outputToken", [32]],
        ["inputAmount", "u64"],
        ["outputAmount", [32]],
        ["destinationChainId", "u64"],
        ["exclusiveRelayer", [32]],
        ["quoteTimestamp", "u32"],
        ["fillDeadline", "u32"],
        ["exclusivityParameter", "u32"],
        ["message", ["u8"]],
      ],
    },
  ],
]);

function getDepositSeedHash(depositData: any) {
  const ds = new DepositSeedData({
    depositor: depositData.depositor.toBuffer(),
    recipient: depositData.recipient.toBuffer(),
    inputToken: depositData.inputToken.toBuffer(),
    outputToken: depositData.outputToken.toBuffer(),
    inputAmount: depositData.inputAmount,
    outputAmount: depositData.outputAmount,
    destinationChainId: depositData.destinationChainId,
    exclusiveRelayer: depositData.exclusiveRelayer.toBuffer(),
    quoteTimestamp: depositData.quoteTimestamp,
    fillDeadline: depositData.fillDeadline,
    exclusivityParameter: depositData.exclusivityParameter,
    message: depositData.message,
  });

  return deriveSeedHash(depositSeedSchema, ds);
}

export function getDepositPda(depositData: string, programId: PublicKey) {
  const seedHash = getDepositSeedHash(depositData);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("delegate"), seedHash], programId);
  return pda;
}
