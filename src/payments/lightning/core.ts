/**
 * Core Lightning Operations (createInvoice, payInvoice, getBalance)
 * @module payments/lightning/core
 */
import {
  createInvoice as lnCreateInvoice,
  payViaPaymentRequest,
  getWalletInfo,
} from 'ln-service';
import type { LNDClient } from './client.js';
import type { InvoiceResponse, PaymentResponse } from './types.js';

export async function createInvoiceCore(
  lnd: LNDClient,
  amount: number,
  memo: string,
  expiry: number = 3600
): Promise<InvoiceResponse | null> {
  try {
    const result = await (lnCreateInvoice as any)({
      lnd,
      tokens: amount,
      description: memo,
      expires_at: new Date(Date.now() + expiry * 1000).toISOString(),
    });

    return {
      paymentHash: result.id,
      paymentRequest: result.request,
      amount,
      status: 'open',
    };
  } catch (error) {
    console.error('[Lightning] Failed to create invoice:', error);
    return null;
  }
}

export async function payInvoiceCore(
  lnd: LNDClient,
  paymentRequest: string
): Promise<PaymentResponse> {
  try {
    const result = await payViaPaymentRequest({ lnd, request: paymentRequest });
    return {
      success: true,
      paymentHash: result.payment_hash || '',
      preimage: result.payment_secret,
    };
  } catch (error) {
    console.error('[Lightning] Failed to pay invoice:', error);
    return { success: false, paymentHash: '' };
  }
}

export async function getBalanceCore(lnd: LNDClient): Promise<number> {
  try {
    const result = await getWalletInfo({ lnd });
    return result.confirmed_balance || 0;
  } catch (error) {
    console.warn('[Lightning] Failed to get balance:', error);
    return 0;
  }
}
