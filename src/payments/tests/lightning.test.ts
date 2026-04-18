/**
 * Lightning Service Tests - Vitest
 * @module payments/tests/lightning
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ln-service before importing
vi.mock('ln-service', () => ({
  authenticatedLndGrpc: vi.fn(),
  createInvoice: vi.fn(),
  payViaPaymentRequest: vi.fn(),
  getWalletInfo: vi.fn(),
  settleInvoice: vi.fn(),
  cancelHodlInvoice: vi.fn(),
  subscribeToInvoice: vi.fn(),
}));

import { LightningService } from '../lightning/service.js';
import { HodlService } from '../hodl/service.js';
import * as lnService from 'ln-service';

describe('LightningService', () => {
  let service: LightningService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LightningService({ type: 'lnd' });
  });

  describe('createInvoice with LND configured', () => {
    it('should call ln-service createInvoice and return invoice data', async () => {
      // Setup: Mock env vars present
      const oldHost = process.env.LND_HOST;
      const oldMacaroon = process.env.LND_MACAROON_HEX;
      process.env.LND_HOST = 'localhost:10009';
      process.env.LND_MACAROON_HEX = 'deadbeef';

      // Mock ln-service responses
      const mockLnd = {} as any;
      vi.mocked(lnService.authenticatedLndGrpc).mockReturnValue(mockLnd);
      vi.mocked(lnService.createInvoice).mockResolvedValue({
        id: 'payment-hash-123',
        request: 'lnbc100n1...',
      });

      // Create fresh service after env setup
      service = new LightningService({ type: 'lnd' });

      // Execute
      const result = await service.createInvoice(100, 'Test memo');

      // Verify
      expect(result).not.toBeNull();
      expect(result?.paymentHash).toBe('payment-hash-123');
      expect(result?.paymentRequest).toBe('lnbc100n1...');
      expect(result?.amount).toBe(100);
      expect(result?.status).toBe('open');

      // Cleanup
      process.env.LND_HOST = oldHost;
      process.env.LND_MACAROON_HEX = oldMacaroon;
    });
  });

  describe('createInvoice without LND_HOST', () => {
    it('should return null and not crash', async () => {
      // Setup: Clear env vars
      const oldHost = process.env.LND_HOST;
      const oldMacaroon = process.env.LND_MACAROON_HEX;
      delete process.env.LND_HOST;
      delete process.env.LND_MACAROON_HEX;

      // Create fresh service with no env
      service = new LightningService({ type: 'lnd' });

      // Execute
      const result = await service.createInvoice(100, 'Test');

      // Verify: Graceful fallback
      expect(result).toBeNull();
      expect(service.isConfigured()).toBe(false);

      // Cleanup
      if (oldHost) process.env.LND_HOST = oldHost;
      if (oldMacaroon) process.env.LND_MACAROON_HEX = oldMacaroon;
    });
  });

  describe('HODL flow', () => {
    it('should settle HODL invoice with mocked gRPC', async () => {
      // Setup env
      const oldHost = process.env.LND_HOST;
      const oldMacaroon = process.env.LND_MACAROON_HEX;
      process.env.LND_HOST = 'localhost:10009';
      process.env.LND_MACAROON_HEX = 'deadbeef';

      const mockLnd = {} as any;
      vi.mocked(lnService.authenticatedLndGrpc).mockReturnValue(mockLnd);

      service = new LightningService({ type: 'lnd' });

      // Create HODL invoice
      vi.mocked(lnService.createInvoice).mockResolvedValue({
        id: 'hodl-hash-123',
        request: 'lnbc_hodl_...',
      });

      const invoice = await service.createHodlInvoice(1000, 'job-123', 'HODL test');
      expect(invoice).not.toBeNull();

      // Settle it
      vi.mocked((lnService as any).settleInvoice).mockResolvedValue(undefined);
      const settled = await service.settleHodlInvoice('preimage-abc');
      expect(settled).toBe(true);

      // Cleanup
      process.env.LND_HOST = oldHost;
      process.env.LND_MACAROON_HEX = oldMacaroon;
    });
  });
});

describe('HodlService', () => {
  let hodlService: HodlService;

  beforeEach(() => {
    vi.clearAllMocks();
    hodlService = new HodlService();
  });

  describe('3-step HODL flow', () => {
    it('should create -> wait -> settle with mocked ln-service', async () => {
      // Setup env
      const oldHost = process.env.LND_HOST;
      const oldMacaroon = process.env.LND_MACAROON_HEX;
      process.env.LND_HOST = 'localhost:10009';
      process.env.LND_MACAROON_HEX = 'deadbeef';

      const mockLnd = {} as any;
      vi.mocked(lnService.authenticatedLndGrpc).mockReturnValue(mockLnd);

      hodlService = new HodlService();

      // Step 1: Create HODL invoice
      vi.mocked(lnService.createInvoice).mockResolvedValue({
        id: 'test-hash-xyz',
        request: 'lnbc500n1hodl...',
      });

      const created = await hodlService.createHodlInvoice(500, 'job-456');
      expect(created).not.toBeNull();
      expect(created?.paymentHash).toBeTruthy();
      expect(created?.invoice).toBe('lnbc500n1hodl...');

      // Step 2: Route payment (mock subscription)
      const mockEmitter = {
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'invoice_updated') {
            // Simulate held then settled
            setTimeout(() => cb({ is_held: true }), 10);
            setTimeout(() => cb({ is_confirmed: true, secret: 'secret-123' }), 50);
          }
        }),
        removeAllListeners: vi.fn(),
      };
      vi.mocked((lnService as any).subscribeToInvoice).mockReturnValue(mockEmitter as any);

      const routed = await hodlService.routePayment(created!.invoice, 1000);
      expect(routed?.paid).toBe(true);
      expect(routed?.preimage).toBe('secret-123');

      // Step 3: Settle
      vi.mocked((lnService as any).settleInvoice).mockResolvedValue(undefined);
      const settled = await hodlService.settleHodlInvoice(created!.paymentHash);
      expect(settled).toBe(true);

      // Cleanup
      process.env.LND_HOST = oldHost;
      process.env.LND_MACAROON_HEX = oldMacaroon;
    });
  });
});
