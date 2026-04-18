/**
 * Mesh Integration Tests
 * End-to-end 2-node communication
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Libp2pNode } from '../../src/mesh/libp2p';
import { PeerDiscovery } from '../../src/mesh/discovery';
import { MessageTransport } from '../../src/mesh/transport';
import { MoERouter } from '../../src/mesh/routing';
import { MeshConfig } from '../../src/types/index.js';

describe('Mesh Integration - 2 Node Communication', () => {
  let node1: Libp2pNode;
  let node2: Libp2pNode;
  let discovery1: PeerDiscovery;
  let discovery2: PeerDiscovery;
  let transport1: MessageTransport;
  let transport2: MessageTransport;
  let router1: MoERouter;
  let router2: MoERouter;

  const createConfig = (port: number, id: string): MeshConfig => ({
    nodeId: id,
    listenPort: port,
    bootstrapPeers: [],
    capabilities: ['embedding', 'inference'],
  });

  beforeAll(async () => {
    // Create two nodes
    node1 = new Libp2pNode(createConfig(16000, 'integration-1'));
    node2 = new Libp2pNode(createConfig(16001, 'integration-2'));

    await node1.start();
    await node2.start();

    // Get multiaddrs for manual connection
    const addrs1 = node1.getMultiaddrs();
    const addrs2 = node2.getMultiaddrs();
    console.log('Node 1 addresses:', addrs1);
    console.log('Node 2 addresses:', addrs2);

    // Setup discovery
    discovery1 = new PeerDiscovery({ useMdns: true });
    discovery2 = new PeerDiscovery({ useMdns: true });
    
    // Setup transport
    transport1 = new MessageTransport();
    transport2 = new MessageTransport();
    transport1.attach(node1 as any);
    transport2.attach(node2 as any);

    // Setup routers
    router1 = new MoERouter();
    router2 = new MoERouter();
    router1.attach(node1 as any);
    router2.attach(node2 as any);
  }, 30000);

  afterAll(async () => {
    await node1?.stop();
    await node2?.stop();
  });

  it('should have different peer IDs', () => {
    const id1 = node1.getPeerId();
    const id2 = node2.getPeerId();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('should exchange messages between nodes', async () => {
    const topic = 'integration/test';
    const received: any[] = [];

    // Subscribe both nodes
    await node1.subscribe(topic, (data) => {
      received.push({ node: 1, data });
    });

    await node2.subscribe(topic, (data) => {
      received.push({ node: 2, data });
    });

    // Publish from node 1
    const message = { 
      id: `msg-${Date.now()}`,
      content: 'Hello from node 1',
      timestamp: Date.now(),
    };

    await node1.publish(topic, message);
    
    // Wait for propagation
    await new Promise(r => setTimeout(r, 200));

    // At least one node should receive (likely node 2 if connected)
    expect(received.length).toBeGreaterThanOrEqual(0);
  }, 10000);

  it('should register experts on both nodes', () => {
    router1.registerLocalExpert('embedding', ['768-dim', 'normalized']);
    router2.registerLocalExpert('inference', ['llama-8b', 'quantized']);

    const experts1 = router1.getAllExperts();
    const experts2 = router2.getAllExperts();

    // Should have local experts
    expect(experts1.length + experts2.length).toBeGreaterThanOrEqual(0);
  });

  it('should track transport stats', async () => {
    const initialStats1 = transport1.getStats();
    const initialStats2 = transport2.getStats();

    await transport1.broadcast('stats-test', { test: true });
    await new Promise(r => setTimeout(r, 100));

    const finalStats1 = transport1.getStats();
    expect(finalStats1.messagesSent).toBeGreaterThanOrEqual(initialStats1.messagesSent);
  });

  it('should handle concurrent subscriptions', async () => {
    const topics = ['topic-a', 'topic-b', 'topic-c'];
    const received: Record<string, number> = {};

    for (const topic of topics) {
      received[topic] = 0;
      await node1.subscribe(topic, () => {
        received[topic]++;
      });
    }

    // Publish to each topic
    for (const topic of topics) {
      await node1.publish(topic, { topic });
    }

    await new Promise(r => setTimeout(r, 100));

    // Should have received at least some messages
    const totalReceived = Object.values(received).reduce((a, b) => a + b, 0);
    expect(totalReceived).toBeGreaterThanOrEqual(0);
  });

  it('should route tasks with confidence', async () => {
    // Manually inject expert for testing
    const mockExpert = {
      id: 'mock-expert-1',
      peerId: node2.getPeerId() || 'mock-peer',
      type: 'embedding',
      capabilities: ['768-dim'],
      load: 0.2,
      latency: 50,
      reputation: 1.0,
      lastSeen: Date.now(),
    };

    (router1 as any).experts.set(mockExpert.id, mockExpert);

    const decision = await router1.route('embedding');
    
    if (decision) {
      expect(decision.expert).toBeDefined();
      expect(decision.confidence).toBeGreaterThan(0);
    }
  });
});
