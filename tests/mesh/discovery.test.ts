/**
 * Peer Discovery Tests
 * mDNS and bootstrap peer discovery
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createLibp2p, type Libp2pOptions } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';
import { PeerDiscovery } from '../../src/mesh/discovery';

describe('PeerDiscovery', () => {
  let discovery: PeerDiscovery;
  let node: any;

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

  it('should attach to libp2p node', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    await discovery.attach(node);
    expect(discovery.getPeerCount()).toBe(0);
  });

  it('should track discovered peers', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    
    const discovered: string[] = [];
    discovery.on('discovered', (peer) => {
      discovered.push(peer.id);
    });

    await discovery.attach(node);
    
    // Simulate discovery via internal handleDiscovery (adds to internal Map and emits event)
    (discovery as any).handleDiscovery('test-peer-1', ['/ip4/127.0.0.1/tcp/10000'], 'bootstrap');

    expect(discovered).toContain('test-peer-1');
    expect(discovery.getPeerCount()).toBe(1);
  });

  it('should clear stale peers', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    await discovery.attach(node);

    // Add old peer via internal handleDiscovery
    (discovery as any).handleDiscovery('stale-peer', [], 'mdns');
    // Backdate the timestamp
    const peer = (discovery as any).discovered.get('stale-peer');
    if (peer) peer.timestamp = Date.now() - 600000;

    expect(discovery.getPeerCount()).toBe(1);
    
    discovery.clearStalePeers(300000); // 5 min threshold
    expect(discovery.getPeerCount()).toBe(0);
  });

  it('should announce capabilities', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    await discovery.attach(node);

    const announced: any[] = [];
    discovery.on('announce', (data) => {
      announced.push(data);
    });

    discovery.announceCapabilities(['embedding', 'inference']);
    
    expect(announced.length).toBe(1);
    expect(announced[0].capabilities).toContain('embedding');
  });

  it('should handle connected/disconnected events', async () => {
    discovery = new PeerDiscovery({ useMdns: false });
    await discovery.attach(node);

    const events: string[] = [];
    discovery.on('connected', () => events.push('connected'));
    discovery.on('disconnected', () => events.push('disconnected'));

    // Trigger via EventTarget dispatchEvent (libp2p uses EventTarget, not EventEmitter)
    const connectEvent = new Event('peer:connect');
    (connectEvent as any).detail = { toString: () => 'peer-1' };
    node.dispatchEvent(connectEvent);
    const disconnectEvent = new Event('peer:disconnect');
    (disconnectEvent as any).detail = { toString: () => 'peer-1' };
    node.dispatchEvent(disconnectEvent);

    expect(events).toContain('connected');
    expect(events).toContain('disconnected');
  });
});
