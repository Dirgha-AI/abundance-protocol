/**
 * Message Transport Tests
 * GossipSub message reliability and latency
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLibp2p, type Libp2pOptions } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { MessageTransport, MeshMessage } from '../../src/mesh/transport';

describe('MessageTransport', () => {
  let transport: MessageTransport;
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
    
    transport = new MessageTransport();
    transport.attach(node);
  });

  afterEach(async () => {
    await node?.stop();
  });

  it('should subscribe to topics', async () => {
    await transport.subscribe('test-topic');
    const topics = transport.getSubscribedTopics();
    expect(topics).toContain('test-topic');
  });

  it('should broadcast messages', async () => {
    await transport.subscribe('broadcast-test');
    
    const received: MeshMessage[] = [];
    transport.on('message:broadcast-test', (msg) => {
      received.push(msg);
    });

    await transport.broadcast('broadcast-test', { data: 'test' }, { priority: 'high' });
    await new Promise(r => setTimeout(r, 100));

    expect(transport.getStats().messagesSent).toBe(1);
  });

  it('should track message statistics', async () => {
    await transport.subscribe('stats-test');
    
    transport.on('message', () => {
      // Handle message
    });

    const initialStats = transport.getStats();
    expect(initialStats.messagesSent).toBe(0);
    expect(initialStats.messagesReceived).toBe(0);

    await transport.broadcast('stats-test', { test: true });
    
    const finalStats = transport.getStats();
    expect(finalStats.messagesSent).toBe(1);
    expect(finalStats.bytesTransferred).toBeGreaterThan(0);
  });

  it('should handle expired messages', async () => {
    await transport.subscribe('expiry-test');
    
    const expired: string[] = [];
    transport.on('expired', (data) => {
      expired.push(data.id);
    });

    // Simulate expired message by setting timestamp in past
    const oldMessage: MeshMessage = {
      id: 'expired-1',
      topic: 'expiry-test',
      payload: {},
      timestamp: Date.now() - 60000, // 60 seconds ago
      ttl: 1000, // 1 second TTL
      priority: 'normal',
      sender: 'test',
    };

    // Emit directly to simulate receipt
    transport.emit('message', oldMessage);
    
    // Wait for processing
    await new Promise(r => setTimeout(r, 50));
    
    // Message should be filtered by TTL check
    expect(transport.getStats().messagesReceived).toBe(0);
  });

  it('should reset statistics', async () => {
    await transport.subscribe('reset-test');
    await transport.broadcast('reset-test', {});
    
    expect(transport.getStats().messagesSent).toBeGreaterThan(0);
    
    transport.resetStats();
    const stats = transport.getStats();
    
    expect(stats.messagesSent).toBe(0);
    expect(stats.messagesReceived).toBe(0);
    expect(stats.bytesTransferred).toBe(0);
  });

  it('should track latency', async () => {
    await transport.subscribe('latency-test');
    
    transport.emit('message', {
      id: 'lat-1',
      topic: 'latency-test',
      payload: {},
      timestamp: Date.now() - 50, // 50ms ago
      ttl: 30000,
      priority: 'normal',
      sender: 'test',
    });

    await new Promise(r => setTimeout(r, 10));
    
    const stats = transport.getStats();
    expect(stats.latencyAvg).toBeGreaterThan(0);
  });
});
