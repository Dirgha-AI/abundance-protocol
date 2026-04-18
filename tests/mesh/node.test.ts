/**
 * Mesh Node Tests
 * 2-node communication and libp2p integration tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Libp2pNode } from '../../src/mesh/libp2p';
import { MeshConfig } from '../../src/types/index.js';

describe('Libp2pNode', () => {
  let node1: Libp2pNode;
  let node2: Libp2pNode;

  const createConfig = (port: number, id: string): MeshConfig => ({
    nodeId: id,
    listenPort: port,
    bootstrapPeers: [],
    capabilities: ['inference', 'embedding'],
  });

  afterEach(async () => {
    await node1?.stop();
    await node2?.stop();
  });

  it('should start and stop a single node', async () => {
    node1 = new Libp2pNode(createConfig(15000, 'test-1'));
    await node1.start();
    expect(node1.getPeerId()).toBeTruthy();
    expect(node1.getMultiaddrs().length).toBeGreaterThan(0);
  });

  it('should create two nodes with different peer IDs', async () => {
    node1 = new Libp2pNode(createConfig(15001, 'node-1'));
    node2 = new Libp2pNode(createConfig(15002, 'node-2'));
    
    await node1.start();
    await node2.start();

    const id1 = node1.getPeerId();
    const id2 = node2.getPeerId();

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('should publish and receive messages on a topic', async () => {
    node1 = new Libp2pNode(createConfig(15003, 'pub-1'));
    await node1.start();

    const received: unknown[] = [];
    await node1.subscribe('test/topic', (data) => {
      received.push(data);
    });

    const message = { type: 'test', content: 'hello' };
    await node1.publish('test/topic', message);

    // Wait for message propagation
    await new Promise(r => setTimeout(r, 100));

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toEqual(message);
  });

  it('should handle multiple subscribers on same topic', async () => {
    node1 = new Libp2pNode(createConfig(15004, 'multi-1'));
    await node1.start();

    const received1: unknown[] = [];
    const received2: unknown[] = [];

    await node1.subscribe('multi/topic', (data) => received1.push(data));
    await node1.subscribe('multi/topic', (data) => received2.push(data));

    await node1.publish('multi/topic', { test: 'multi' });
    await new Promise(r => setTimeout(r, 100));

    expect(received1.length).toBeGreaterThan(0);
    expect(received2.length).toBeGreaterThan(0);
  });

  it('should track connected peers', async () => {
    node1 = new Libp2pNode(createConfig(15005, 'peer-1'));
    await node1.start();

    const peers = node1.getConnectedPeers();
    expect(Array.isArray(peers)).toBe(true);
  });

  it('should report correct multiaddrs', async () => {
    node1 = new Libp2pNode(createConfig(15006, 'addr-1'));
    await node1.start();

    const addrs = node1.getMultiaddrs();
    expect(addrs.length).toBeGreaterThan(0);
    expect(addrs[0]).toContain('/ip4/');
    expect(addrs[0]).toContain('/tcp/15006');
  });
});
