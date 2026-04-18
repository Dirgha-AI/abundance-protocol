import { PaymentTick } from './types';

export class PaymentStreamManager {
  private activeStreams = new Map<string, { active: boolean; intervalId?: ReturnType<typeof setTimeout> }>();

  async *streamPayment(
    payInvoice: (invoice: string) => Promise<{ success: boolean }>,
    recipientInvoice: string,
    satPerInterval: number,
    intervalMs: number,
    durationMs: number
  ): AsyncGenerator<PaymentTick> {
    const streamId = 'stream-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    this.activeStreams.set(streamId, { active: true });
    const numTicks = Math.floor(durationMs / intervalMs);

    for (let i = 0; i < numTicks; i++) {
      const stream = this.activeStreams.get(streamId);
      if (!stream?.active) break;

      const result = await payInvoice(recipientInvoice);
      yield {
        streamId,
        sent: satPerInterval,
        total: (i + 1) * satPerInterval,
        timestamp: new Date(),
        success: result.success,
      };

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    this.activeStreams.delete(streamId);
  }

  stopStream(streamId: string): void {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.active = false;
      if (stream.intervalId) clearTimeout(stream.intervalId);
    }
  }

  isActive(streamId: string): boolean {
    return this.activeStreams.get(streamId)?.active ?? false;
  }
}
