import { LightningConfig, UpstreamPayment } from '../types/index.js';

export interface InvoiceResult {
  paymentHash: string;
  paymentRequest: string;
  amount: number;
  expiresAt: string;
}

export interface PaymentResult {
  success: boolean;
  paymentHash: string;
  recipient?: string;
  taskId?: string;
  intendedAmount?: number;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  description: string;
  timestamp: string;
  status: string;
}

export interface PaymentConfig {
  config: LightningConfig;
  baseUrl: string;
}
