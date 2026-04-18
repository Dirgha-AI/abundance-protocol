import { LightningConfig } from '../types/index.js';
import { InvoiceResult, PaymentResult, Transaction } from './types.js';

export async function strikeFetch(
  config: LightningConfig,
  baseUrl: string,
  path: string,
  options?: RequestInit
): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Strike API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

export async function createStrikeInvoice(
  config: LightningConfig,
  baseUrl: string,
  amount: number,
  description: string
): Promise<InvoiceResult> {
  const btcAmount = amount / 100_000_000;
  const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;

  const response = await strikeFetch(config, baseUrl, '/invoices', {
    method: 'POST',
    body: JSON.stringify({
      correlationId,
      description,
      amount: { currency: 'BTC', amount: btcAmount.toString() },
    }),
  }) as { paymentHash: string; lnInvoice: string; expirationDate: string };

  return {
    paymentHash: response.paymentHash,
    paymentRequest: response.lnInvoice,
    amount,
    expiresAt: response.expirationDate,
  };
}

export async function payStrikeInvoice(
  config: LightningConfig,
  baseUrl: string,
  paymentRequest: string
): Promise<PaymentResult> {
  const response = await strikeFetch(config, baseUrl, '/payments', {
    method: 'POST',
    body: JSON.stringify({ lnInvoice: paymentRequest }),
  }) as { state: string; paymentHash: string };

  return {
    success: response.state === 'SUCCESS' || response.state === 'PENDING',
    paymentHash: response.paymentHash,
  };
}

export async function getStrikeBalance(
  config: LightningConfig,
  baseUrl: string
): Promise<number> {
  const response = await strikeFetch(config, baseUrl, '/balances') as {
    items: Array<{ currency: string; amount: string }>;
  };
  const btcBalance = response.items.find((item) => item.currency === 'BTC');
  if (!btcBalance) return 0;
  return Math.floor(parseFloat(btcBalance.amount) * 100_000_000);
}

export async function getStrikeHistory(
  config: LightningConfig,
  baseUrl: string,
  limit: number
): Promise<Transaction[]> {
  const response = await strikeFetch(
    config,
    baseUrl,
    `/transactions?limit=${limit}&offset=0`
  ) as {
    items: Array<{
      id: string;
      type: string;
      amount: string;
      currency: string;
      description?: string;
      created: string;
      state: string;
    }>;
  };

  return response.items.map((item) => ({
    id: item.id,
    type: item.type,
    amount: Math.floor(parseFloat(item.amount) * 100_000_000),
    currency: item.currency,
    description: item.description || '',
    timestamp: item.created,
    status: item.state,
  }));
}
