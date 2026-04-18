/**
 * MoE Routing Tests
 * Mixture of Experts routing accuracy
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createLibp2p, type Libp2pOptions } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import { MoERouter, Expert } from '../../src/mesh/routing';

describe('MoERouter', () => {
  let router: MoERouter;
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
    
    router = new MoERouter();
    router.attach(node);
  });

  it('should register local experts', () => {
    router.registerLocalExpert('code-gen', ['javascript', 'typescript']);
    router.registerLocalExpert('embedding', ['vectorization']);
    
    const stats = router.getStats();
    expect(stats.byType['code-gen']).toBe(1);
  });

  it('should find experts by type', () => {
    // Simulate expert announcement
    const expert: Expert = {
      id: 'peer-1-embedding',
      peerId: 'peer-1',
      type: 'embedding',
      capabilities: ['vectorization', 'dim-768'],
      load: 0.5,
      latency: 100,
      reputation: 1.0,
      lastSeen: Date.now(),
    };
    
    router.emit('expert:discovered', expert);
    // Manually add to internal map
    (router as any).experts.set(expert.id, expert);

    const found = router.findExperts('embedding');
    expect(found.length).toBe(1);
    expect(found[0].type).toBe('embedding');
  });

  it('should route to best expert', async () => {
    // Add multiple experts
    const experts: Expert[] = [
      {
        id: 'peer-1-inference',
        peerId: 'peer-1',
        type: 'inference',
        capabilities: ['llama', 'gemma'],
        load: 0.8,
        latency: 200,
        reputation: 0.9,
        lastSeen: Date.now(),
      },
      {
        id: 'peer-2-inference',
        peerId: 'peer-2',
        type: 'inference',
        capabilities: ['llama'],
        load: 0.3,
        latency: 50,
        reputation: 1.0,
        lastSeen: Date.now(),
      },
    ];

    for (const expert of experts) {
      (router as any).experts.set(expert.id, expert);
    }

    const decision = await router.route('inference', ['llama']);
    
    expect(decision).not.toBeNull();
    expect(decision!.expert.id).toBe('peer-2-inference'); // Lower load, higher score
    expect(decision!.alternatives.length).toBe(1);
  });

  it('should return null when no experts found', async () => {
    const decision = await router.route('nonexistent-type');
    expect(decision).toBeNull();
  });

  it('should filter experts by requirements', () => {
    const experts: Expert[] = [
      {
        id: 'peer-1',
        peerId: 'peer-1',
        type: 'training',
        capabilities: ['pytorch', 'distributed'],
        load: 0.5,
        latency: 100,
        reputation: 1.0,
        lastSeen: Date.now(),
      },
      {
        id: 'peer-2',
        peerId: 'peer-2',
        type: 'training',
        capabilities: ['tensorflow'],
        load: 0.3,
        latency: 50,
        reputation: 1.0,
        lastSeen: Date.now(),
      },
    ];

    for (const expert of experts) {
      (router as any).experts.set(expert.id, expert);
    }

    const pytorchExperts = router.findExperts('training', ['pytorch']);
    expect(pytorchExperts.length).toBe(1);
    expect(pytorchExperts[0].id).toBe('peer-1');
  });

  it('should calculate scores correctly', () => {
    const expert: Expert = {
      id: 'test-expert',
      peerId: 'test',
      type: 'test',
      capabilities: [],
      load: 0.5, // 50% load = 0.5 score
      latency: 500, // 500ms = 0.5 score
      reputation: 1.0, // 1.0 score
      lastSeen: Date.now(),
    };

    (router as any).experts.set(expert.id, expert);

    const routes = router.getRoutesForType('test');
    expect(routes.length).toBe(1);
    
    // Score = loadFactor*0.4 + latencyFactor*0.3 + reputation*0.3
    // = 0.5*0.4 + 0.5*0.3 + 1.0*0.3 = 0.2 + 0.15 + 0.3 = 0.65
    expect(routes[0].score).toBeCloseTo(0.65, 1);
  });

  it('should update expert load', () => {
    const expert: Expert = {
      id: 'load-test',
      peerId: 'test',
      type: 'test',
      capabilities: [],
      load: 0.0,
      latency: 0,
      reputation: 1.0,
      lastSeen: Date.now(),
    };

    (router as any).experts.set(expert.id, expert);
    
    router.updateExpertLoad('load-test', 0.9);
    
    expect(expert.load).toBe(0.9);
    expect(expert.lastSeen).toBeGreaterThan(0);
  });

  it('should cleanup expired experts', () => {
    const oldExpert: Expert = {
      id: 'old-expert',
      peerId: 'old',
      type: 'test',
      capabilities: [],
      load: 0,
      latency: 0,
      reputation: 1,
      lastSeen: Date.now() - 400000, // 6+ minutes old
    };

    (router as any).experts.set(oldExpert.id, oldExpert);
    expect(router.getAllExperts().length).toBe(1);

    // Trigger cleanup manually
    (router as any).cleanup();
    
    expect(router.getAllExperts().length).toBe(0);
  });

  it('should get stats by type', () => {
    const types = ['embedding', 'inference', 'training'];
    
    for (let i = 0; i < types.length; i++) {
      const expert: Expert = {
        id: `expert-${i}`,
        peerId: `peer-${i}`,
        type: types[i],
        capabilities: [],
        load: 0,
        latency: 0,
        reputation: 1,
        lastSeen: Date.now(),
      };
      (router as any).experts.set(expert.id, expert);
    }

    const stats = router.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byType['embedding']).toBe(1);
    expect(stats.byType['inference']).toBe(1);
    expect(stats.byType['training']).toBe(1);
  });
});
