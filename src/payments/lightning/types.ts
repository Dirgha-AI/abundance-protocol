export interface InvoiceResponse {
  paymentHash: string;
  paymentRequest: string;
  amount: number;
  status: 'open' | 'settled' | 'cancelled';
  expiresAt?: string;
}

export interface PaymentResponse {
  success: boolean;
  paymentHash: string;
  preimage?: string;
  feeSats?: number;
  error?: string;
}

export interface PaymentTick {
  streamId: string;
  sent: number;
  total: number;
  timestamp: Date;
  success: boolean;
}

export interface HTLCContract {
  id: string;
  paymentHash: string;
  preimage: string;
  sats: number;
  expiryBlocks: number;
  status: 'pending' | 'settled' | 'cancelled';
}

export interface FeeEstimate {
  feeSats: number;
  feePercent: number;
  route?: string[];
  confidence: number;
}

export interface RoutingPolicy {
  baseFeeSats: number;
  feeRatePpm: number;
  minHtlcMsat: number;
  maxHtlcMsat: number;
}

export interface ChannelInfo {
  id: string;
  capacitySats: number;
  localBalanceSats: number;
  remoteBalanceSats: number;
  channelPoint: string;
}
