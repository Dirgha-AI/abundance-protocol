/**
 * discovery.ts - Peer Discovery (80 lines)
 * mDNS + bootstrap peer discovery for mesh network
 */
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';
import type { Libp2p } from 'libp2p';
import type { GossipSub } from '@libp2p/gossipsub';
import { EventEmitter } from 'events';

export interface DiscoveredPeer {
  id: string;
  multiaddrs: string[];
  protocols: string[];
  timestamp: number;
  source: 'mdns' | 'bootstrap' | 'gossip';
}

export class PeerDiscovery extends EventEmitter {
  private libp2p: Libp2p<{ pubsub: GossipSub }> | null = null;
  private bootstrapList: string[];
  private discovered = new Map<string, DiscoveredPeer>();
  private useMdns: boolean;

  constructor(options: { bootstrapPeers?: string[]; useMdns?: boolean } = {}) {
    super();
    this.bootstrapList = options.bootstrapPeers || [];
    this.useMdns = options.useMdns ?? true;
  }

  async attach(libp2p: Libp2p<{ pubsub: GossipSub }>): Promise<void> {
    this.libp2p = libp2p;
    
    // Setup mDNS discovery
    if (this.useMdns) {
      const mdnsDiscovery = mdns({ interval: 10000 });
      // @ts-ignore - libp2p configuration
      libp2p.peerDiscovery?.push(mdnsDiscovery);
    }

    // Setup bootstrap discovery
    if (this.bootstrapList.length > 0) {
      const bootstrapDiscovery = bootstrap({ list: this.bootstrapList });
      // @ts-ignore - libp2p configuration
      libp2p.peerDiscovery?.push(bootstrapDiscovery);
    }

    // Listen for peer discovery events
    libp2p.addEventListener('peer:discovery', (event: any) => {
      const peerId = event.detail?.id?.toString() || event.detail?.toString();
      if (peerId) {
        this.handleDiscovery(peerId, [], 'mdns');
      }
    });

    libp2p.addEventListener('peer:connect', (event: any) => {
      const peerId = event.detail?.toString();
      this.emit('connected', { id: peerId, timestamp: Date.now() });
    });

    libp2p.addEventListener('peer:disconnect', (event: any) => {
      const peerId = event.detail?.toString();
      this.emit('disconnected', { id: peerId, timestamp: Date.now() });
    });
  }

  private handleDiscovery(id: string, addrs: string[], source: 'mdns' | 'bootstrap' | 'gossip'): void {
    const peer: DiscoveredPeer = {
      id,
      multiaddrs: addrs,
      protocols: [],
      timestamp: Date.now(),
      source,
    };
    this.discovered.set(id, peer);
    this.emit('discovered', peer);
  }

  announceCapabilities(capabilities: string[]): void {
    if (!this.libp2p) return;
    const announcement = {
      peerId: this.libp2p.peerId.toString(),
      capabilities,
      timestamp: Date.now(),
    };
    this.emit('announce', announcement);
  }

  getDiscoveredPeers(): DiscoveredPeer[] {
    return Array.from(this.discovered.values());
  }

  getPeerCount(): number {
    return this.discovered.size;
  }

  clearStalePeers(maxAgeMs: number = 300000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, peer] of this.discovered) {
      if (peer.timestamp < cutoff) {
        this.discovered.delete(id);
      }
    }
  }
}

export default PeerDiscovery;
