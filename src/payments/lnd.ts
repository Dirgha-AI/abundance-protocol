// REQUIRES: LND node at process.env.LND_GRPC_HOST:10009 with macaroon at process.env.LND_MACAROON_PATH

import {
  authenticatedLndGrpc,
  getWalletInfo,
  createInvoice as lnCreateInvoice,
  payViaPaymentRequest,
  getChannels,
  openChannel as lnOpenChannel
} from 'ln-service';

export interface Channel {
  channelId: string;
  remotePubkey: string;
  localBalanceSats: number;
  remoteBalanceSats: number;
  active: boolean;
}

// ln-service LND client type (opaque)
type LNDClient = ReturnType<typeof authenticatedLndGrpc>;

export class LNDService {
  private lnd: LNDClient;

  constructor(config: { socket: string; macaroon: string; cert?: string }) {
    const { socket, macaroon, cert } = config;
    this.lnd = authenticatedLndGrpc({
      socket,
      macaroon,
      cert: cert || ''
    });
  }

  private async getLnd(): Promise<any> {
    if (!this.lnd) {
      throw new Error('LND not initialized');
    }
    return this.lnd;
  }

  async getBalance(): Promise<number> {
    try {
      const lnd = await this.getLnd();
      const result = await getWalletInfo({ lnd });
      return result.confirmed_balance || 0;
    } catch (error) {
      return 0;
    }
  }

  async createInvoice(sats: number, memo: string): Promise<{ paymentRequest: string; paymentHash: string }> {
    const lnd = await this.getLnd();
    const result = await lnCreateInvoice({
      lnd,
      tokens: sats,
      description: memo
    });
    return {
      paymentRequest: result.request,
      paymentHash: result.id
    };
  }

  async payInvoice(paymentRequest: string): Promise<{ preimage: string; feeSats: number }> {
    const lnd = await this.getLnd();
    const result = await payViaPaymentRequest({
      lnd,
      request: paymentRequest
    });
    return {
      preimage: result.payment_secret || '',
      feeSats: result.safe_fee || 0
    };
  }

  async executePaymentSplit(
    taskId: string,
    totalSats: number,
    workerInvoice: string,
    validatorInvoices: string[],
    treasuryInvoice: string
  ): Promise<void> {
    const workerAmount = Math.floor(totalSats * 0.7);
    const validatorTotal = Math.floor(totalSats * 0.2);
    const validatorAmount = validatorInvoices.length > 0 ? Math.floor(validatorTotal / validatorInvoices.length) : 0;
    const treasuryAmount = totalSats - workerAmount - (validatorAmount * validatorInvoices.length);

    try {
      const result = await this.payInvoice(workerInvoice);
      console.log(`[${taskId}] Paid worker ${workerAmount} sats (70%), preimage: ${result.preimage}, fee: ${result.feeSats}`);
    } catch (error) {
      console.error(`[${taskId}] Failed to pay worker (70% = ${workerAmount} sats): ${error}`);
    }

    for (let i = 0; i < validatorInvoices.length; i++) {
      try {
        const result = await this.payInvoice(validatorInvoices[i]);
        console.log(`[${taskId}] Paid validator ${i} ${validatorAmount} sats (split of 20%), preimage: ${result.preimage}, fee: ${result.feeSats}`);
      } catch (error) {
        console.error(`[${taskId}] Failed to pay validator ${i} (${validatorAmount} sats): ${error}`);
      }
    }

    try {
      const result = await this.payInvoice(treasuryInvoice);
      console.log(`[${taskId}] Paid treasury ${treasuryAmount} sats (10%), preimage: ${result.preimage}, fee: ${result.feeSats}`);
    } catch (error) {
      console.error(`[${taskId}] Failed to pay treasury (10% = ${treasuryAmount} sats): ${error}`);
    }
  }

  async openChannel(peerPubkey: string, localSats: number): Promise<{ channelId: string }> {
    const lnd = await this.getLnd();
    const result = await lnOpenChannel({
      lnd,
      local_tokens: localSats,
      partner_public_key: peerPubkey
    });
    return {
      channelId: result.transaction_id
    };
  }

  async listChannels(): Promise<Channel[]> {
    try {
      const lnd = await this.getLnd();
      const result = await getChannels({ lnd });

      if (!result.channels || !Array.isArray(result.channels)) {
        return [];
      }

      return result.channels.map((ch: any) => ({
        channelId: ch.id,
        remotePubkey: ch.partner_public_key,
        localBalanceSats: ch.local_balance || 0,
        remoteBalanceSats: ch.remote_balance || 0,
        active: ch.is_active || false
      }));
    } catch (error) {
      return [];
    }
  }

  async getNodeInfo(): Promise<{ pubkey: string; alias: string; numChannels: number }> {
    try {
      const lnd = await this.getLnd();
      const result = await getWalletInfo({ lnd });
      return {
        pubkey: result.public_key || '',
        alias: result.alias || '',
        numChannels: result.active_channels_count || 0
      };
    } catch (error) {
      return {
        pubkey: '',
        alias: '',
        numChannels: 0
      };
    }
  }
}

export default LNDService;
