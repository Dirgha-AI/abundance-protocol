/**
 * Mesh-LLM Integration Tests
 * Tests the distributed inference system end-to-end
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MeshLLMAdapter } from '../src/mesh-llm/adapter.js'
import { selectPeers } from '../src/mesh-llm/routing.js'
import type { GPUPeer, InferenceJob, MeshLLMConfig } from '../src/mesh-llm/types.js'

// Mock BuckyNode
const mockNode = {
  getNodeId: () => 'test-node-id',
  getPeers: vi.fn(() => ['peer-1', 'peer-2', 'peer-3']),
  onPeerDiscovered: vi.fn(),
  publishMessage: vi.fn(),
  sendInferenceToPeer: vi.fn().mockResolvedValue({
    content: 'Mock inference result',
    tokensGenerated: 42,
    latencyMs: 100,
    success: true,
  }),
}

// Mock ConsensusEngine
const mockConsensus = {
  createRound: vi.fn().mockReturnValue({ roundId: 'round-1', status: 'pending' }),
  vote: vi.fn(),
  getResult: vi.fn().mockResolvedValue({ status: 'passed', result: 'verified' }),
}

// Mock LightningService
const mockLightning = {
  pay: vi.fn().mockResolvedValue({ success: true }),
}

// Sample GPU peers
const mockPeers: GPUPeer[] = [
  {
    peerId: 'peer-1', nodeId: 'node-1', addresses: ['/ip4/127.0.0.1/tcp/9001'],
    capabilities: { gpu: { model: 'RTX 4090', vram: 24 }, cpu: { cores: 16, model: 'i9' }, memory: 64 },
    models: ['llama3.2', 'gemma-4', 'codestral'],
    load: 0.2, latencyMs: 50, lastSeen: new Date(), reputation: 0.9,
    pricing: { perToken: 0.000001, perSecond: 0.01 },
  },
  {
    peerId: 'peer-2', nodeId: 'node-2', addresses: ['/ip4/127.0.0.1/tcp/9002'],
    capabilities: { gpu: { model: 'RTX 3080', vram: 10 }, cpu: { cores: 8, model: 'Ryzen 9' }, memory: 32 },
    models: ['llama3.2', 'phi-3'],
    load: 0.7, latencyMs: 120, lastSeen: new Date(), reputation: 0.75,
    pricing: { perToken: 0.0000005, perSecond: 0.005 },
  },
]

const sampleJob: InferenceJob = {
  id: 'job-1', prompt: 'Hello world', model: 'llama3.2',
  maxTokens: 100, temperature: 0.7, userId: 'user-1',
  priority: 'normal', requireVerification: false,
}

// ---------------------------------------------------------------------------
// MeshLLMAdapter — lifecycle
// ---------------------------------------------------------------------------
describe('MeshLLMAdapter', () => {
  let adapter: MeshLLMAdapter

  beforeEach(() => {
    adapter = new MeshLLMAdapter({
      buckyNode: mockNode as any,
      consensus: mockConsensus as any,
      lightning: mockLightning as any,
      config: {
        routingStrategy: 'least-loaded',
        fallbackToLocal: true,
        defaultVerificationPeers: 2,
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should discover GPU peers (returns array)', async () => {
    const peers = await adapter.discoverGPUPeers()
    expect(Array.isArray(peers)).toBe(true)
  })

  it('should expose getGPUPeers()', () => {
    const peers = adapter.getGPUPeers()
    expect(Array.isArray(peers)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// selectPeers — routing algorithm
// ---------------------------------------------------------------------------
describe('selectPeers — routing algorithm', () => {
  const baseConfig: MeshLLMConfig = {
    routingStrategy: 'least-loaded',
    minReputationScore: 0.5,
    defaultVerificationPeers: 1,
    discoveryIntervalMs: 30000,
    healthCheckIntervalMs: 60000,
    maxConcurrentInferences: 10,
    enableAutoScaling: false,
    fallbackToLocal: true,
  }

  it('selects least-loaded peer by default', () => {
    const result = selectPeers(sampleJob, mockPeers, baseConfig)
    expect(result.primary.peerId).toBe('peer-1') // lower load
  })

  it('selects cheapest peer with lowest-cost strategy', () => {
    const result = selectPeers(sampleJob, mockPeers, {
      ...baseConfig,
      routingStrategy: 'lowest-cost',
    })
    expect(result.primary.peerId).toBe('peer-2') // cheaper per token
  })

  it('excludes peers without the required model', () => {
    const jobForGemma = { ...sampleJob, model: 'gemma-4' }
    const result = selectPeers(jobForGemma, mockPeers, baseConfig)
    // Only peer-1 has gemma-4
    expect(result.primary.peerId).toBe('peer-1')
  })

  it('throws when no capable peers found', () => {
    const jobUnknownModel = { ...sampleJob, model: 'unknown-model-xyz' }
    expect(() => selectPeers(jobUnknownModel, mockPeers, baseConfig)).toThrow('No capable peers')
  })

  it('excludes low-reputation peers', () => {
    const lowRepPeers = mockPeers.map(p => ({ ...p, reputation: 0.3 }))
    expect(() =>
      selectPeers(sampleJob, lowRepPeers, { ...baseConfig, minReputationScore: 0.8 })
    ).toThrow()
  })

  it('returns verifiers array', () => {
    const result = selectPeers(sampleJob, mockPeers, baseConfig)
    expect(Array.isArray(result.verifiers)).toBe(true)
  })

  it('throws when all peers are overloaded', () => {
    const overloaded = mockPeers.map(p => ({ ...p, load: 0.95 }))
    expect(() => selectPeers(sampleJob, overloaded, baseConfig)).toThrow()
  })

  it('respects budget constraints', () => {
    const expensiveJob = { ...sampleJob, budget: 0.000000001 }
    const expensivePeers = mockPeers.map(p => ({
      ...p,
      pricing: { perToken: 10, perSecond: 1 },
    }))
    expect(() => selectPeers(expensiveJob, expensivePeers, baseConfig)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Peer Selection — extended strategies
// ---------------------------------------------------------------------------
describe('Peer Selection — extended strategies', () => {
  const threePeers: GPUPeer[] = [
    {
      peerId: 'low-load', nodeId: 'node-1', addresses: [],
      capabilities: { gpu: { model: 'A100', vram: 80 }, cpu: { cores: 64, model: 'EPYC' }, memory: 512 },
      models: ['gemma-4', 'qwen-32b'],
      load: 0.2, latencyMs: 100, lastSeen: new Date(), reputation: 0.8,
      pricing: { perToken: 0.002, perSecond: 0.02 },
    },
    {
      peerId: 'high-load', nodeId: 'node-2', addresses: [],
      capabilities: { gpu: { model: 'H100', vram: 80 }, cpu: { cores: 128, model: 'EPYC' }, memory: 1024 },
      models: ['gemma-4', 'llama-70b'],
      load: 0.8, latencyMs: 50, lastSeen: new Date(), reputation: 0.95,
      pricing: { perToken: 0.001, perSecond: 0.01 },
    },
    {
      peerId: 'cheap', nodeId: 'node-3', addresses: [],
      capabilities: { gpu: { model: 'RTX 4090', vram: 24 }, cpu: { cores: 16, model: 'i9' }, memory: 64 },
      models: ['gemma-4'],
      load: 0.5, latencyMs: 200, lastSeen: new Date(), reputation: 0.7,
      pricing: { perToken: 0.0005, perSecond: 0.005 },
    },
  ]

  const job: InferenceJob = {
    id: 'test', prompt: 'test', model: 'gemma-4',
    maxTokens: 1000, temperature: 0.7, userId: 'test', priority: 'normal',
  }

  const config: MeshLLMConfig = {
    discoveryIntervalMs: 30000, healthCheckIntervalMs: 60000,
    maxConcurrentInferences: 10, defaultVerificationPeers: 2,
    minReputationScore: 0.5, routingStrategy: 'least-loaded',
    enableAutoScaling: true, fallbackToLocal: true,
  }

  it('selects peer with lowest load', () => {
    const result = selectPeers(job, threePeers, config)
    expect(result.primary.peerId).toBe('low-load')
  })

  it('selects cheapest peer when strategy is lowest-cost', () => {
    const result = selectPeers(job, threePeers, { ...config, routingStrategy: 'lowest-cost' })
    expect(result.primary.peerId).toBe('cheap')
  })

  it('selects highest-reputation peer', () => {
    const result = selectPeers(job, threePeers, { ...config, routingStrategy: 'highest-reputation' })
    expect(result.primary.peerId).toBe('high-load')
  })

  it('selects closest (lowest-latency) peer', () => {
    const result = selectPeers(job, threePeers, { ...config, routingStrategy: 'closest' })
    expect(result.primary.peerId).toBe('high-load')
  })

  it('selects correct verifier count', () => {
    const result = selectPeers(job, threePeers, config)
    expect(result.verifiers.length).toBe(config.defaultVerificationPeers)
    expect(result.verifiers.map(v => v.peerId)).not.toContain(result.primary.peerId)
  })

  it('filters by model availability', () => {
    const jobWithRareModel = { ...job, model: 'llama-70b' }
    const result = selectPeers(jobWithRareModel, threePeers, config)
    expect(result.primary.models).toContain('llama-70b')
  })
})

// ---------------------------------------------------------------------------
// MeshLLMProvider — fallback path
// ---------------------------------------------------------------------------
describe('MeshLLMProvider fallback', () => {
  it('returns a non-empty string when no adapter and Ollama is not running', async () => {
    const { MeshLLMProvider } = await import('../src/mesh-llm/provider.js')
    const provider = new MeshLLMProvider()
    // No adapter set, no Ollama running in CI — should return fallback message
    const result = await provider.distributedChat('test', 'user-1')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('delegates to adapter.routeInference when adapter is set', async () => {
    const { MeshLLMProvider } = await import('../src/mesh-llm/provider.js')
    const provider = new MeshLLMProvider()
    const fakeAdapter = {
      routeInference: vi.fn().mockResolvedValue({ content: 'adapter-result' }),
    }
    provider.setAdapter(fakeAdapter as any)
    const result = await provider.distributedChat('hello', 'user-2', 'llama3.2')
    expect(fakeAdapter.routeInference).toHaveBeenCalledOnce()
    expect(result).toBe('adapter-result')
  })
})

// ---------------------------------------------------------------------------
// Payment estimates
// ---------------------------------------------------------------------------
describe('Payment calculations', () => {
  it('estimatedCost is positive when peers have non-zero pricing', () => {
    const peer: GPUPeer = {
      peerId: 'test', nodeId: 'test', addresses: [],
      capabilities: { gpu: { model: 'A100', vram: 80 }, cpu: { cores: 64, model: 'EPYC' }, memory: 512 },
      models: ['gemma-4'], load: 0.5, latencyMs: 100, lastSeen: new Date(), reputation: 0.9,
      pricing: { perToken: 0.001, perSecond: 0.01 },
    }
    const job: InferenceJob = {
      id: 'test', prompt: 'test', model: 'gemma-4',
      maxTokens: 1000, temperature: 0.7, userId: 'test', priority: 'normal',
    }
    const result = selectPeers(job, [peer], {
      routingStrategy: 'least-loaded', minReputationScore: 0.5, defaultVerificationPeers: 0,
      discoveryIntervalMs: 30000, healthCheckIntervalMs: 60000, maxConcurrentInferences: 10,
      enableAutoScaling: false, fallbackToLocal: true,
    })
    expect(result.estimatedCost).toBeGreaterThan(0)
  })
})
