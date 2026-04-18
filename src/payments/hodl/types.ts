/**
 * HODL Invoice Types
 * @module payments/hodl/types
 */

export interface HodlInvoice {
  paymentHash: string;
  invoice: string;
  amountSats: number;
  jobId: string;
  status: 'pending' | 'paid' | 'settled' | 'cancelled';
  createdAt: Date;
}

export interface CreateHodlResult {
  paymentHash: string;
  invoice: string;
}

export interface RoutePaymentResult {
  paid: boolean;
  paymentHash?: string;
  preimage?: string;
}
