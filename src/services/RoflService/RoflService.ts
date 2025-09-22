import axios, { AxiosInstance } from "axios";
import { Agent } from "http";
import * as http from "http";
import logger from "../../lib/winston";

interface TxParams {
  gas: string | number;
  to: string;
  value: string | number;
  data: string;
}

const DEFAULT_SOCKET_PATH = "/run/rofl-appd.sock";

const client = axios.create({
  baseURL: "http://localhost",
  httpAgent: new http.Agent({}),
  socketPath: DEFAULT_SOCKET_PATH,
});

export const ROFL = {
  async getKey(code: string, type: "secp256k1" | "ed25519"): Promise<string> {
    if (type == "secp256k1") {
      return this.getECDSA(code);
    }
    return this.getEd25519(code);
  },

  async getECDSA(code: string): Promise<string> {
    let privateKey = await this.fetchKey(code, "secp256k1");
    return privateKey;
  },

  async getEd25519(code: string): Promise<string> {
    let privateKey = await this.fetchKey(code, "ed25519");
    return privateKey;
  },

  async fetchKey(id: string, type: "secp256k1" | "ed25519"): Promise<string> {
    const payload = {
      key_id: id,
      kind: type,
    };
    const path = "/rofl/v1/keys/generate";
    const response = (await this._appdPost(path, payload)) as { key: string };
    return response.key;
  },

  async submitTx(tx: TxParams): Promise<unknown> {
    const payload = {
      tx: {
        kind: "eth",
        data: {
          gas_limit: tx.gas,
          to: tx.to.replace(/^0x/, ""),
          value: tx.value,
          data: tx.data.replace(/^0x/, ""),
        },
      },
      encrypted: false,
    };
    const path = "/rofl/v1/tx/sign-submit";
    return this._appdPost(path, payload);
  },

  async _appdPost(path: string, payload: unknown): Promise<unknown> {
    const fullUrl = `${path}`;
    try {
      const response = await client.post(fullUrl, payload, {
        timeout: 0,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Request failed: ${error.response?.status || "unknown status"} ` + `${error.response?.statusText || error.message}`);
    }
  },

  log(message: string) {
    logger.info(`[ROFL] - ${message}`);
  },
};
