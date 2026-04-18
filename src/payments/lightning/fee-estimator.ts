import { FeeEstimate, ChannelInfo } from './types';

export class LightningFeeEstimator {
  private baseFee = 1000;
  private feeRatePpm = 1000;
  private probeCache = new Map<string, { fee: number; timestamp: number }>();
  private cacheTTL = 60000;

  async estimateFee(
    sats: number,
    destination: string,
    pathfinder?: (dest: string, amt: number) => Promise<{ feeSats: number; route: string[] }>
  ): Promise<FeeEstimate> {
    const cacheKey = `${destination}-${sats}`;
    const cached = this.probeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return {
        feeSats: cached.fee,
        feePercent: (cached.fee / sats) * 100,
        route: undefined,
        confidence: 0.9,
      };
    }

    let routeFee = 0;
    let route: string[] | undefined;
    let confidence = 0.5;

    if (pathfinder) {
      try {
        const result = await pathfinder(destination, sats);
        routeFee = result.feeSats;
        route = result.route;
        confidence = 0.95;
      } catch {
        // Fallback to local estimate
      }
    }

    const localEstimate = this.calculateLocalEstimate(sats);
    const finalFee = Math.max(routeFee, localEstimate);
    this.probeCache.set(cacheKey, { fee: finalFee, timestamp: Date.now() });

    return {
      feeSats: finalFee,
      feePercent: (finalFee / sats) * 100,
      route,
      confidence,
    };
  }

  private calculateLocalEstimate(sats: number): number {
    const proportional = Math.floor((sats * this.feeRatePpm) / 1000000);
    const riskPremium = Math.floor(sats * 0.005);
    return this.baseFee + proportional + riskPremium;
  }

  estimateMultiHop(sats: number, hops: number, channels: ChannelInfo[]): FeeEstimate {
    const baseFee = this.baseFee * hops;
    const proportional = Math.floor((sats * this.feeRatePpm * hops) / 1000000);
    const capacityPenalty = this.calculateCapacityPenalty(sats, channels);
    const totalFee = baseFee + proportional + capacityPenalty;

    return {
      feeSats: totalFee,
      feePercent: (totalFee / sats) * 100,
      route: undefined,
      confidence: 0.7 + (0.05 * Math.min(hops, 4)),
    };
  }

  private calculateCapacityPenalty(sats: number, channels: ChannelInfo[]): number {
    const relevant = channels.filter((c) => c.capacitySats >= sats);
    if (relevant.length === 0) return Infinity;
    const avgCapacity = relevant.reduce((sum, c) => sum + c.capacitySats, 0) / relevant.length;
    const utilization = sats / avgCapacity;
    return Math.floor(sats * utilization * 0.001);
  }

  setPolicy(baseFee: number, feeRatePpm: number): void {
    this.baseFee = baseFee;
    this.feeRatePpm = feeRatePpm;
  }

  clearCache(): void {
    this.probeCache.clear();
  }
}
