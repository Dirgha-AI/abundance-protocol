/**
 * routing.ts - MoE Routing Logic (100 lines)
 * Mixture of Experts routing over libp2p network
 */
import { EventEmitter } from 'events';
import type { Libp2p } from 'libp2p';
import type { GossipSub } from '@libp2p/gossipsub';

export interface Expert {
  id: string;
  peerId: string;
  type: string;
  capabilities: string[];
  load: number;
  latency: number;
  reputation: number;
  lastSeen: number;
}

export interface MoERoute {
  expertId: string;
  expertType: string;
  targetPeer: string;
  score: number;
  estimatedLatency: number;
}

export interface RoutingDecision {
  expert: Expert;
  confidence: number;
  alternatives: Expert[];
}

export class MoERouter extends EventEmitter {
  private libp2p: Libp2p<{ pubsub: GossipSub }> | null = null;
  private experts = new Map<string, Expert>();
  private localExpertTypes: string[] = [];
  private routeCache = new Map<string, { route: MoERoute; expires: number }>();
  private CACHE_TTL = 30000;

  attach(input: any): void {
    // Support both raw libp2p node and Libp2pNode wrapper
    const libp2p = input?.services ? input : input?.getNode?.();
    if (!libp2p) return;
    this.libp2p = libp2p;

    // Listen for expert announcements
    libp2p.services.pubsub.subscribe('bucky/experts');
    libp2p.services.pubsub.addEventListener('message', (event: any) => {
      if (event.detail.topic === 'bucky/experts') {
        this.handleExpertAnnouncement(event.detail);
      }
    });

    // Periodic cleanup
    setInterval(() => this.cleanup(), 60000);
  }

  registerLocalExpert(type: string, capabilities: string[]): void {
    this.localExpertTypes.push(type);
    const id = `local-${type}-${Date.now()}`;
    this.experts.set(id, {
      id, peerId: 'local', type, capabilities,
      load: 0, latency: 0, reputation: 1.0, lastSeen: Date.now(),
    });
    this.announceExpert(type, capabilities);
  }

  private announceExpert(type: string, capabilities: string[]): void {
    if (!this.libp2p) return;
    
    const announcement = {
      peerId: this.libp2p.peerId.toString(),
      expertType: type,
      capabilities,
      timestamp: Date.now(),
      load: 0,
    };

    this.libp2p.services.pubsub.publish(
      'bucky/experts',
      new TextEncoder().encode(JSON.stringify(announcement))
    ).catch(() => { /* no peers in test/isolated env */ });
  }

  private handleExpertAnnouncement(message: any): void {
    try {
      const data = JSON.parse(new TextDecoder().decode(message.data));
      const expert: Expert = {
        id: `${data.peerId}-${data.expertType}`,
        peerId: data.peerId,
        type: data.expertType,
        capabilities: data.capabilities,
        load: data.load || 0,
        latency: Date.now() - data.timestamp,
        reputation: 1.0,
        lastSeen: Date.now(),
      };
      this.experts.set(expert.id, expert);
      this.emit('expert:discovered', expert);
    } catch (err) {
      this.emit('error', { type: 'announcement_parse', error: err });
    }
  }

  async route(taskType: string, requirements: string[] = []): Promise<RoutingDecision | null> {
    const candidates = this.findExperts(taskType, requirements);
    if (candidates.length === 0) return null;

    // Score and sort
    const scored = candidates.map(e => ({
      expert: e,
      score: this.calculateScore(e),
    })).sort((a, b) => b.score - a.score);

    return {
      expert: scored[0].expert,
      confidence: scored[0].score,
      alternatives: scored.slice(1, 4).map(s => s.expert),
    };
  }

  findExperts(type: string, requirements: string[] = []): Expert[] {
    const matching: Expert[] = [];
    for (const expert of this.experts.values()) {
      if (expert.type === type || expert.capabilities.includes(type)) {
        if (requirements.length === 0 || requirements.every(r => expert.capabilities.includes(r))) {
          matching.push(expert);
        }
      }
    }
    return matching;
  }

  private calculateScore(expert: Expert): number {
    const loadFactor = 1 - Math.min(expert.load, 1);
    const latencyFactor = Math.max(0, 1 - expert.latency / 1000);
    const reputationFactor = expert.reputation;
    return (loadFactor * 0.4 + latencyFactor * 0.3 + reputationFactor * 0.3);
  }

  getRoutesForType(expertType: string): MoERoute[] {
    const experts = this.findExperts(expertType);
    return experts.map(e => ({
      expertId: e.id,
      expertType: e.type,
      targetPeer: e.peerId,
      score: this.calculateScore(e),
      estimatedLatency: e.latency,
    })).sort((a, b) => b.score - a.score);
  }

  updateExpertLoad(expertId: string, load: number): void {
    const expert = this.experts.get(expertId);
    if (expert) {
      expert.load = load;
      expert.lastSeen = Date.now();
    }
  }

  private cleanup(): void {
    const cutoff = Date.now() - 300000; // 5 minutes
    for (const [id, expert] of this.experts) {
      if (expert.lastSeen < cutoff) {
        this.experts.delete(id);
        this.emit('expert:expired', { id });
      }
    }
    
    // Clean route cache
    const now = Date.now();
    for (const [key, entry] of this.routeCache) {
      if (entry.expires < now) {
        this.routeCache.delete(key);
      }
    }
  }

  getAllExperts(): Expert[] {
    return Array.from(this.experts.values());
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const expert of this.experts.values()) {
      byType[expert.type] = (byType[expert.type] || 0) + 1;
    }
    return { total: this.experts.size, byType };
  }
}

export default MoERouter;

export { MoERouter as ContentRouter };
