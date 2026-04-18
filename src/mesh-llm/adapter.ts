/**
 * Mesh-LLM Adapter - Distributed inference routing with consensus
 */

import { EventEmitter } from 'events'
import type { BuckyNode } from '../mesh/node.js'
import type { ConsensusEngine } from '../consensus/engine.js'
import type { LightningService } from '../payments/lightning.js'
import type { 
  GPUPeer, InferenceJob, InferenceResponse, 
  MeshLLMConfig, VerificationResult 
} from './types.js'
import { selectPeers, PeerSelectionResult } from './routing.js'

export interface MeshLLMOptions {
  buckyNode: BuckyNode
  consensus: ConsensusEngine
  lightning: LightningService
  config?: Partial<MeshLLMConfig>
}

export class MeshLLMAdapter extends EventEmitter {
  private node: BuckyNode
  private consensus: ConsensusEngine
  private lightning: LightningService
  private config: MeshLLMConfig
  private gpuPeers: Map<string, GPUPeer> = new Map()
  private activeJobs: Map<string, InferenceJob> = new Map()
  private discoveryInterval?: NodeJS.Timeout
  private healthCheckInterval?: NodeJS.Timeout

  constructor(options: MeshLLMOptions) {
    super()
    this.node = options.buckyNode
    this.consensus = options.consensus
    this.lightning = options.lightning
    this.config = {
      discoveryIntervalMs: 30000,
      healthCheckIntervalMs: 60000,
      maxConcurrentInferences: 10,
      defaultVerificationPeers: 3,
      minReputationScore: 0.5,
      routingStrategy: 'least-loaded',
      enableAutoScaling: true,
      fallbackToLocal: true,
      ...options.config
    }
  }

  async start(): Promise<void> {
    // Subscribe to GPU peer announcements
    this.node.onPeerDiscovered((peer) => {
      this.handlePeerDiscovery(peer)
    })

    // Start discovery loop
    this.discoveryInterval = setInterval(() => {
      this.discoverGPUPeers()
    }, this.config.discoveryIntervalMs)

    // Start health checks
    this.healthCheckInterval = setInterval(() => {
      this.healthCheckPeers()
    }, this.config.healthCheckIntervalMs)

    this.emit('started')
  }

  async stop(): Promise<void> {
    clearInterval(this.discoveryInterval)
    clearInterval(this.healthCheckInterval)
    this.emit('stopped')
  }

  async discoverGPUPeers(): Promise<GPUPeer[]> {
    // Broadcast discovery request
    const discoveryMsg = {
      type: 'mesh-llm:discovery',
      nodeId: this.node.getNodeId(),
      timestamp: Date.now(),
      capabilities: { models: [], gpu: true }
    }

    // Query all connected peers
    const peers = this.node.getPeers()
    this.emit('discovery:start', { peerCount: peers.length })

    // Return currently known GPU peers
    return Array.from(this.gpuPeers.values())
  }

  async registerLocalGPU(gpuInfo: {
    model: string
    vram: number
    models: string[]
  }): Promise<void> {
    // Advertise local GPU capabilities
    const announcement = {
      type: 'mesh-llm:capabilities',
      nodeId: this.node.getNodeId(),
      gpu: gpuInfo,
      pricing: { perToken: 0.001, perSecond: 0.01 },
      timestamp: Date.now()
    }

    // Publish to mesh
    // Implementation depends on BuckyNode publish method
    this.emit('gpu:registered', gpuInfo)
  }

  async routeInference(job: InferenceJob): Promise<InferenceResponse> {
    // Check if we have GPU peers
    const peers = Array.from(this.gpuPeers.values())
    
    if (peers.length === 0 && this.config.fallbackToLocal) {
      // Fallback to local inference
      return this.executeLocalInference(job)
    }

    // Select optimal peers
    let selection: PeerSelectionResult
    try {
      selection = selectPeers(job, peers, this.config)
    } catch (err) {
      if (this.config.fallbackToLocal) {
        return this.executeLocalInference(job)
      }
      throw err
    }

    // Check budget
    if (job.budget && selection.estimatedCost > job.budget) {
      throw new Error(`Estimated cost ${selection.estimatedCost} sats exceeds budget ${job.budget}`)
    }

    // Execute with verification if required
    if (job.requireVerification ?? true) {
      return this.executeWithConsensus(job, selection)
    }

    // Simple execution without verification
    return this.executeDirect(job, selection.primary)
  }

  private async executeDirect(job: InferenceJob, peer: GPUPeer): Promise<InferenceResponse> {
    const startTime = Date.now()
    
    // Send inference request to peer
    const result = await this.sendInferenceRequest(peer, job)
    
    const latencyMs = Date.now() - startTime
    const tokensPerSecond = (result.tokensGenerated / latencyMs) * 1000

    // Calculate payment
    const cost = result.tokensGenerated * peer.pricing.perToken

    return {
      jobId: job.id,
      content: result.content,
      tokensGenerated: result.tokensGenerated,
      tokensPerSecond,
      latencyMs,
      peerId: peer.peerId,
      verified: false,
      verifications: [],
      cost,
      paymentSplit: {
        worker: Math.floor(cost * 0.9),
        verifiers: 0,
        treasury: Math.floor(cost * 0.1)
      }
    }
  }

  private async executeWithConsensus(
    job: InferenceJob, 
    selection: PeerSelectionResult
  ): Promise<InferenceResponse> {
    const startTime = Date.now()

    // Execute on primary
    const primaryResult = await this.executeDirect(job, selection.primary)

    // Request verifications from other peers
    const verifications: VerificationResult[] = []
    
    if (selection.verifiers.length > 0) {
      const verificationPromises = selection.verifiers.map(async (verifier) => {
        try {
          const v = await this.requestVerification(verifier, job, primaryResult.content)
          verifications.push(v)
          return v
        } catch (err) {
          return null
        }
      })

      // Wait for 2/3 of verifiers to respond (or timeout)
      await Promise.all(verificationPromises)
    }

    // Check consensus
    const matches = verifications.filter(v => v.matches).length
    const requiredMatches = Math.ceil(selection.verifiers.length * 0.66)
    const verified = matches >= requiredMatches || selection.verifiers.length === 0

    // Calculate verification costs
    const verificationCost = verifications.reduce((sum, v) => {
      const verifier = selection.verifiers.find(p => p.nodeId === v.verifierId)
      return sum + (verifier?.pricing.perToken || 0) * primaryResult.tokensGenerated * 0.2
    }, 0)

    const totalCost = primaryResult.cost + verificationCost

    const latencyMs = Date.now() - startTime
    const tokensPerSecond = (primaryResult.tokensGenerated / latencyMs) * 1000

    // Payment split: 70% worker, 20% verifiers, 10% treasury
    const workerAmount = Math.floor(totalCost * 0.70)
    const verifierTotal = Math.floor(totalCost * 0.20)
    const verifierShare = Math.floor(verifierTotal / Math.max(verifications.length, 1))
    const treasuryAmount = totalCost - workerAmount - (verifierShare * verifications.length)

    if (job.budget && totalCost > 0) {
      try {
        await this.lightning.executePaymentSplit(
          Math.round(totalCost),
          { worker: selection.primary.peerId, platform: 'platform', treasury: 'treasury' },
          `worker-invoice:${job.id}`,
          verifications.map(v => `verifier-invoice:${v.verifierId}:${job.id}`),
          `treasury-invoice:${job.id}`
        )
      } catch (e) {
        console.warn('[MeshLLM] Payment split failed:', e)
        // Non-fatal — result still returned
      }
    }

    return {
      jobId: job.id,
      content: primaryResult.content,
      tokensGenerated: primaryResult.tokensGenerated,
      tokensPerSecond,
      latencyMs,
      peerId: selection.primary.peerId,
      verified,
      verifications,
      cost: totalCost,
      paymentSplit: {
        worker: workerAmount,
        verifiers: verifierShare * verifications.length,
        treasury: treasuryAmount
      }
    }
  }

  private async executeLocalInference(job: InferenceJob): Promise<InferenceResponse> {
    // Call local Ollama
    const startTime = Date.now()
    
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: job.model,
        prompt: job.prompt,
        stream: false,
        options: {
          temperature: job.temperature,
          num_predict: job.maxTokens
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Local inference failed: ${response.status}`)
    }

    const data = await response.json()
    const latencyMs = Date.now() - startTime
    const tokensGenerated = data.eval_count || Math.ceil(data.response.length / 4)

    return {
      jobId: job.id,
      content: data.response,
      tokensGenerated,
      tokensPerSecond: (tokensGenerated / latencyMs) * 1000,
      latencyMs,
      peerId: 'local',
      verified: true,
      verifications: [],
      cost: 0,
      paymentSplit: { worker: 0, verifiers: 0, treasury: 0 }
    }
  }

  private async sendInferenceRequest(peer: GPUPeer, job: InferenceJob): Promise<{ content: string, tokensGenerated: number }> {
    this.emit('inference:request', { peer, job })
    const raw = await this.node.sendInferenceToPeer(peer.peerId, job)
    if (!raw.success) {
      throw new Error(`Peer inference failed: ${raw.error || 'unknown error'}`)
    }
    return { content: raw.content as string, tokensGenerated: raw.tokensGenerated as number }
  }

  private async requestVerification(
    verifier: GPUPeer, 
    job: InferenceJob, 
    result: string
  ): Promise<VerificationResult> {
    this.emit('verification:request', { verifier, job })
    
    // Placeholder
    return {
      verifierId: verifier.nodeId,
      peerId: verifier.peerId,
      matches: true,
      confidence: 0.95,
      timestamp: new Date()
    }
  }

  private handlePeerDiscovery(peer: any): void {
    // Parse peer info for GPU capabilities
    if (peer.capabilities?.gpu) {
      const gpuPeer: GPUPeer = {
        peerId: peer.peerId || peer.id,
        nodeId: peer.nodeId,
        addresses: peer.addresses || [],
        capabilities: peer.capabilities,
        models: peer.models || [],
        load: peer.load || 0,
        latencyMs: peer.latencyMs || 100,
        lastSeen: new Date(),
        reputation: peer.reputation || 0.5,
        pricing: peer.pricing || { perToken: 0.001, perSecond: 0.01 }
      }
      
      this.gpuPeers.set(gpuPeer.peerId, gpuPeer)
      this.emit('peer:gpu:discovered', gpuPeer)
    }
  }

  private healthCheckPeers(): void {
    const now = Date.now()
    const staleThreshold = 5 * 60 * 1000 // 5 minutes

    for (const [peerId, peer] of this.gpuPeers) {
      if (now - peer.lastSeen.getTime() > staleThreshold) {
        this.gpuPeers.delete(peerId)
        this.emit('peer:stale', peerId)
      }
    }
  }

  getGPUPeers(): GPUPeer[] {
    return Array.from(this.gpuPeers.values())
  }

  getActiveJobs(): InferenceJob[] {
    return Array.from(this.activeJobs.values())
  }
}
