/**
 * Bucky Mesh Network - Production Module
 * Complete libp2p-based distributed system
 */

// Core modules
export { Libp2pNode } from './libp2p.js';
export { PeerDiscovery } from './discovery.js';
export { MessageTransport } from './transport.js';
export { MoERouter } from './routing.js';

// Legacy compatibility
export { BuckyNode } from './node.js';
export { MeshProtocol } from './protocol.js';
export { ContentRouter } from './routing.js';

// Types
export type { MeshPeer, MoERoute, GossipMessage } from './protocol.js';
export type { DiscoveredPeer } from './discovery.js';
export type { MeshMessage, TransportStats } from './transport.js';
export type { Expert, RoutingDecision } from './routing.js';

/**
 * MeshNetwork - High-level orchestrator
 * Combines all mesh components into unified interface
 */
import { Libp2pNode } from './libp2p.js';
import { PeerDiscovery } from './discovery.js';
import { MessageTransport } from './transport.js';
import { MoERouter } from './routing.js';
import { MeshConfig } from '../types/index.js';

export interface MeshNetworkOptions {
  config: MeshConfig;
  bootstrapPeers?: string[];
  useMdns?: boolean;
}

export class MeshNetwork {
  private node: Libp2pNode;
  private discovery: PeerDiscovery;
  private transport: MessageTransport;
  private router: MoERouter;

  constructor(options: MeshNetworkOptions) {
    this.node = new Libp2pNode(options.config);
    this.discovery = new PeerDiscovery({
      bootstrapPeers: options.bootstrapPeers,
      useMdns: options.useMdns ?? true,
    });
    this.transport = new MessageTransport();
    this.router = new MoERouter();
  }

  async start(): Promise<void> {
    await this.node.start();
    await this.discovery.attach(this.node as any);
    this.transport.attach(this.node as any);
    this.router.attach(this.node as any);
  }

  async stop(): Promise<void> {
    await this.node.stop();
  }

  getNodeId(): string | null {
    return this.node.getPeerId();
  }

  async broadcast(topic: string, data: unknown): Promise<void> {
    await this.transport.broadcast(topic, data);
  }

  async subscribe(topic: string, handler: (data: unknown) => void): Promise<void> {
    await this.transport.subscribe(topic);
    this.transport.on(`message:${topic}`, handler);
  }

  getPeers(): string[] {
    return this.node.getConnectedPeers();
  }

  getStats(): {
    peers: number;
    messagesSent: number;
    messagesReceived: number;
    experts: number;
  } {
    const transportStats = this.transport.getStats();
    const routerStats = this.router.getStats();

    return {
      peers: this.node.getConnectedPeers().length,
      messagesSent: transportStats.messagesSent,
      messagesReceived: transportStats.messagesReceived,
      experts: routerStats.total,
    };
  }
}

export default MeshNetwork;
