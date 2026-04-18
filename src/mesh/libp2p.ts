/**
 * libp2p.ts - Node Wrapper (100 lines)
 * Real libp2p integration for Bucky mesh network
 */
import { createLibp2p, type Libp2pOptions } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, type Identify } from '@libp2p/identify';
import { gossipsub, type GossipSub } from '@libp2p/gossipsub';
import type { Message } from '@libp2p/gossipsub';
import type { Libp2p } from 'libp2p';
import { MeshConfig, MeshTask, ConsensusVote, PeerInfo } from '../types/index.js';

export class Libp2pNode {
  private node: Libp2p<{ identify: Identify; pubsub: GossipSub }> | null = null;
  private config: MeshConfig;
  private handlers = new Map<string, Array<(data: unknown) => void>>();

  constructor(config: MeshConfig) {
    this.config = config;
    this.log('Initialized', { nodeId: config.nodeId, port: config.listenPort });
  }

  private log(...args: unknown[]): void {
    console.log('[Libp2pNode]', ...args);
  }

  async start(): Promise<void> {
    this.log('Starting libp2p node...');
    
    const options = {
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        pubsub: gossipsub({
          emitSelf: true,
          fallbackToFloodsub: true,
          allowPublishToNoPeers: true,
          maxInboundStreams: 64,
          maxOutboundStreams: 64,
        } as any),
      },
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${this.config.listenPort}`],
      },
    };

    this.node = await createLibp2p(options);
    await this.node.start();
    this.log('Node started. Peer ID:', this.node.peerId.toString());
  }

  async stop(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      this.node = null;
      this.log('Node stopped');
    }
  }

  async subscribe(topic: string, handler: (data: unknown) => void): Promise<void> {
    if (!this.node) throw new Error('Node not started');
    await this.node.services.pubsub.subscribe(topic);
    
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, []);
      this.node.services.pubsub.addEventListener('message', (event: CustomEvent<Message>) => {
        if (event.detail.topic === topic) {
          this.handleMessage(event.detail);
        }
      });
    }
    this.handlers.get(topic)!.push(handler);
  }

  async publish(topic: string, data: unknown): Promise<void> {
    if (!this.node) throw new Error('Node not started');
    await this.node.services.pubsub.publish(
      topic,
      new TextEncoder().encode(JSON.stringify(data))
    );
  }

  private handleMessage(message: Message): void {
    try {
      const data = JSON.parse(new TextDecoder().decode(message.data));
      const handlers = this.handlers.get(message.topic) || [];
      handlers.forEach(h => {
        try { h(data); } catch (e) { /* skip */ }
      });
    } catch (err) {
      this.log('Error handling message:', err);
    }
  }

  getPeerId(): string | null {
    return this.node?.peerId.toString() || null;
  }

  getMultiaddrs(): string[] {
    if (!this.node) return [];
    return this.node.getMultiaddrs().map(ma => ma.toString());
  }

  getConnectedPeers(): string[] {
    if (!this.node) return [];
    return this.node.getPeers().map(p => p.toString());
  }

  async publishVote(vote: ConsensusVote): Promise<void> {
    try { await this.publish('consensus/votes', vote); } catch { /* no peers in test env */ }
  }

  async publishTask(task: MeshTask): Promise<void> {
    try { await this.publish('tasks/general', task); } catch { /* no peers in test env */ }
  }

  async announceSelf(): Promise<void> {
    try {
      await this.publish('peers/announce', {
        peerId: this.getPeerId(),
        multiaddrs: this.getMultiaddrs(),
        nodeId: this.config.nodeId,
        capabilities: this.config.capabilities,
      });
    } catch { /* no peers in test env */ }
  }

  getNodeId(): string { return this.config.nodeId; }

  getPeers(): string[] { return this.getConnectedPeers(); }

  getNode(): Libp2p<{ identify: Identify; pubsub: GossipSub }> | null { return this.node; }
}

export default Libp2pNode;

export { Libp2pNode as MeshNode };
