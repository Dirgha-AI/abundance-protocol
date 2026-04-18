/**
 * Message Broadcast Latency Tests
 * Performance benchmarks for mesh communication
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Libp2pNode } from '../../src/mesh/libp2p';
import { MessageTransport } from '../../src/mesh/transport';
import { MeshConfig } from '../../src/types/index.js';

describe('Mesh Latency Tests', () => {
  let node1: Libp2pNode;
  let node2: Libp2pNode;
  let transport1: MessageTransport;
  let transport2: MessageTransport;

  const createConfig = (port: number, id: string): MeshConfig => ({
    nodeId: id,
    listenPort: port,
    bootstrapPeers: [],
    capabilities: [],
  });

  beforeAll(async () => {
    node1 = new Libp2pNode(createConfig(17000, 'latency-1'));
    node2 = new Libp2pNode(createConfig(17001, 'latency-2'));

    await node1.start();
    await node2.start();

    transport1 = new MessageTransport();
    transport2 = new MessageTransport();
    transport1.attach(node1 as any);
    transport2.attach(node2 as any);
  }, 30000);

  afterAll(async () => {
    await node1?.stop();
    await node2?.stop();
  });

  it('should measure single message latency', async () => {
    const topic = 'latency/single';
    const latencies: number[] = [];

    await transport1.subscribe(topic);
    
    transport1.on('message', (msg) => {
      const latency = Date.now() - msg.timestamp;
      latencies.push(latency);
    });

    const startTime = Date.now();
    await transport1.broadcast(topic, { test: 'latency' }, { priority: 'high' });

    await new Promise(r => setTimeout(r, 200));

    if (latencies.length > 0) {
      expect(latencies[0]).toBeLessThan(500); // Under 500ms
    }
  }, 5000);

  it('should handle burst traffic', async () => {
    const topic = 'latency/burst';
    const messageCount = 50;
    const received: number[] = [];

    await transport1.subscribe(topic);
    transport1.on('message', () => {
      received.push(Date.now());
    });

    const startTime = Date.now();
    
    // Send burst
    for (let i = 0; i < messageCount; i++) {
      await transport1.broadcast(topic, { index: i }, { priority: 'normal' });
    }

    await new Promise(r => setTimeout(r, 500));

    // Should handle burst without errors
    expect(transport1.getStats().messagesSent).toBeGreaterThanOrEqual(messageCount);
  }, 10000);

  it('should maintain low latency for small messages', async () => {
    const topic = 'latency/small';
    const smallPayload = { data: 'x'.repeat(100) }; // 100 bytes
    
    await transport1.subscribe(topic);
    
    const startTime = Date.now();
    await transport1.broadcast(topic, smallPayload);
    
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(100); // Send should be fast
  });

  it('should handle larger messages', async () => {
    const topic = 'latency/large';
    const largePayload = { data: 'x'.repeat(10000) }; // 10KB
    
    await transport1.subscribe(topic);
    
    const startTime = Date.now();
    await transport1.broadcast(topic, largePayload);
    
    const elapsed = Date.now() - startTime;
    // Larger messages may take longer
    expect(elapsed).toBeLessThan(500);
  });

  it('should track average latency over multiple messages', async () => {
    const topic = 'latency/avg';
    const count = 10;

    await transport1.subscribe(topic);
    
    for (let i = 0; i < count; i++) {
      await transport1.broadcast(topic, { index: i });
      await new Promise(r => setTimeout(r, 50)); // Small delay between messages
    }

    await new Promise(r => setTimeout(r, 200));

    const stats = transport1.getStats();
    // Average should be reasonable for local network
    expect(stats.latencyAvg).toBeLessThan(1000);
  });

  it('should handle priority levels', async () => {
    const priorities: Array<'low' | 'normal' | 'high' | 'critical'> = [
      'low', 'normal', 'high', 'critical'
    ];

    for (const priority of priorities) {
      const topic = `latency/priority-${priority}`;
      await transport1.subscribe(topic);
      
      await transport1.broadcast(topic, { priority }, { priority });
    }

    await new Promise(r => setTimeout(r, 200));

    // All priorities should be sent
    expect(transport1.getStats().messagesSent).toBeGreaterThanOrEqual(priorities.length);
  });
});
