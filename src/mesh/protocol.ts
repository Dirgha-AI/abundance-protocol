/** mesh-llm Protocol - libp2p MoE Routing Layer */
import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';

export interface MeshPeer { id: string; multiaddrs: string[]; capabilities: string[]; experts: string[]; reputation: number; lastSeen: Date; }
export interface MoERoute { expertType: string; targetPeer: string; score: number; latency: number; }
export interface GossipMessage { topic: string; data: unknown; from: string; timestamp: number; signature?: string; }

export class MeshProtocol extends EventEmitter {
  private peers = new Map<string, MeshPeer>();
  private subscriptions = new Set<string>();
  private nodeId: string;
  private handlers = new Map<string, (data: unknown, peer: string) => Promise<unknown>>();

  constructor(nodeId?: string) { super(); this.nodeId = nodeId || `mesh-${randomUUID().slice(0, 8)}`; }
  getNodeId(): string { return this.nodeId; }

  async start(): Promise<void> {
    this.emit('started', { nodeId: this.nodeId, timestamp: Date.now() });
    setInterval(() => this.broadcastPresence(), 30000);
    setInterval(() => this.pruneStalePeers(), 60000);
  }

  private broadcastPresence(): void {
    this.emit('presence', { nodeId: this.nodeId, capabilities: ['inference','training','embedding','routing'], experts: this.getLocalExperts(), timestamp: Date.now() });
  }

  private getLocalExperts(): string[] { return ['code-gen', 'analysis', 'embedding']; }

  registerExpert(expertType: string, handler: (data: unknown, peer: string) => Promise<unknown>): void {
    this.handlers.set(expertType, handler);
    this.emit('expert:registered', { expertType, nodeId: this.nodeId });
  }

  async routeToExpert(expertType: string, data: unknown): Promise<unknown> {
    const routes = this.findExpertRoutes(expertType);
    if (!routes.length) throw new Error(`No experts for ${expertType}`);
    return this.sendToPeer(routes[0].targetPeer, expertType, data);
  }

  findExpertRoutes(expertType: string): MoERoute[] {
    const routes: MoERoute[] = [];
    for (const [id, peer] of this.peers) {
      if (peer.experts.includes(expertType)) routes.push({ expertType, targetPeer: id, score: peer.reputation, latency: Date.now() - peer.lastSeen.getTime() });
    }
    return routes.sort((a, b) => b.score - a.score);
  }

  async sendToPeer(peerId: string, protocol: string, data: unknown): Promise<unknown> {
    if (!this.peers.has(peerId)) throw new Error(`Peer ${peerId} not found`);
    this.emit('message:sent', { to: peerId, protocol, data });
    return { success: true, echo: data };
  }

  subscribe(topic: string): void { this.subscriptions.add(topic); this.emit('subscribed', { topic }); }
  publish(topic: string, data: unknown): void { this.emit('gossip', { topic, data, from: this.nodeId, timestamp: Date.now(), signature: this.sign(data) }); }
  private sign(data: unknown): string { return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16); }
  onPeerDiscovered(peer: MeshPeer): void { this.peers.set(peer.id, { ...peer, lastSeen: new Date() }); this.emit('peer:discovered', peer); }
  private pruneStalePeers(): void { const cutoff = Date.now() - 120000; for (const [id, peer] of this.peers) if (peer.lastSeen.getTime() < cutoff) { this.peers.delete(id); this.emit('peer:pruned', { id }); } }
  getPeers(): MeshPeer[] { return Array.from(this.peers.values()); }
  getStats(): { peers: number; subscriptions: number; experts: string[] } { return { peers: this.peers.size, subscriptions: this.subscriptions.size, experts: Array.from(this.handlers.keys()) }; }
}

export default MeshProtocol;
