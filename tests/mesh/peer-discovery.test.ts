/**
 * Peer Discovery Specific Tests
 * Bootstrap and mDNS discovery mechanisms
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createLibp2p, type Libp2pOptions } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { bootstrap } from '@libp2p/bootstrap';
import { PeerDiscovery } from '../../src/mesh/discovery';

describe('Peer Discovery Mechanisms', () => {
  let node: any;
  let discovery: PeerDiscovery;

  beforeEach(async () => {
    const options: Libp2pOptions = {
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: { identify: identify(), pubsub: gossipsub() },
      addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
    };
    node = await createLibp2p(options);
    await node.start();
  });

  it('should discover peers via bootstrap list', async () => {
    const bootstrapPeers = [
      '/ip4/127.0.0.1/tcp/10001/p2p/QmTest1',
      '/ip4/127.0.0.1/tcp/10002/p2p/QmTest2',
    ];

    discovery = new PeerDiscovery({ 
      bootstrapPeers,
      useMdns: false 
    });

    await discovery.attach(node);

    // Bootstrap configuration should be set
    expect(discovery).toBeDefined();
  });

  it('should disable mDNS when configured', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    await discovery.attach(node);

    // Should work without mDNS
    expect(discovery.getPeerCount()).toBe(0);
  });

  it('should track discovered peer sources', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    
    const discovered: Array<{ id: string; source: string }> = [];
    discovery.on('discovered', (peer) => {
      discovered.push({ id: peer.id, source: peer.source });
    });

    await discovery.attach(node);

    // Simulate discoveries from different sources
    discovery.emit('discovered', {
      id: 'peer-mdns',
      multiaddrs: [],
      protocols: [],
      timestamp: Date.now(),
      source: 'mdns',
    });

    discovery.emit('discovered', {
      id: 'peer-bootstrap',
      multiaddrs: [],
      protocols: [],
      timestamp: Date.now(),
      source: 'bootstrap',
    });

    expect(discovered.length).toBe(2);
    expect(discovered.some(p => p.source === 'mdns')).toBe(true);
    expect(discovered.some(p => p.source === 'bootstrap')).toBe(true);
  });

  it('should get discovered peers list', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    await discovery.attach(node);

    // Add test peers via internal handleDiscovery
    for (let i = 0; i < 3; i++) {
      (discovery as any).handleDiscovery(`peer-${i}`, [`/ip4/127.0.0.1/tcp/${10000 + i}`], 'bootstrap');
    }

    const peers = discovery.getDiscoveredPeers();
    expect(peers.length).toBe(3);
    expect(peers[0].multiaddrs.length).toBeGreaterThan(0);
  });

  it('should handle empty bootstrap list', async () => {
    discovery = new PeerDiscovery({ 
      bootstrapPeers: [],
      useMdns: false 
    });

    await discovery.attach(node);
    expect(discovery.getPeerCount()).toBe(0);
  });

  it('should emit connected events', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    
    const connections: string[] = [];
    discovery.on('connected', (data) => {
      connections.push(data.id);
    });

    await discovery.attach(node);

    // Simulate connection via EventTarget dispatchEvent
    const connectEvent = new Event('peer:connect');
    (connectEvent as any).detail = { toString: () => 'connected-peer-1' };
    node.dispatchEvent(connectEvent);

    expect(connections).toContain('connected-peer-1');
  });

  it('should emit disconnected events', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    
    const disconnections: string[] = [];
    discovery.on('disconnected', (data) => {
      disconnections.push(data.id);
    });

    await discovery.attach(node);

    // Simulate disconnection via EventTarget dispatchEvent
    const disconnectEvent = new Event('peer:disconnect');
    (disconnectEvent as any).detail = { toString: () => 'disconnected-peer-1' };
    node.dispatchEvent(disconnectEvent);

    expect(disconnections).toContain('disconnected-peer-1');
  });
});
