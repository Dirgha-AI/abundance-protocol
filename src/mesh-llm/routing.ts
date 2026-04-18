/**
 * Mesh-LLM Routing Algorithm
 * Selects optimal peers for inference based on strategy
 */

import type { GPUPeer, InferenceJob, MeshLLMConfig } from './types.js'

export type RoutingStrategy = 'least-loaded' | 'lowest-cost' | 'highest-reputation' | 'closest'

export interface PeerSelectionResult {
  primary: GPUPeer
  verifiers: GPUPeer[]
  estimatedCost: number
  estimatedLatency: number
  confidence: number
}

export function selectPeers(
  job: InferenceJob,
  peers: GPUPeer[],
  config: MeshLLMConfig
): PeerSelectionResult {
  // Filter peers that can handle the job
  const capable = peers.filter(p => canHandleJob(p, job, config))
  
  if (capable.length === 0) {
    throw new Error(`No capable peers found for model ${job.model}`)
  }

  // Sort based on routing strategy
  const sorted = sortPeers(capable, config.routingStrategy)
  
  // Select primary (best peer)
  const primary = sorted[0]
  
  // Select verifiers (next N peers for consensus)
  const verificationCount = job.minPeers || config.defaultVerificationPeers
  const verifiers = sorted.slice(1, 1 + verificationCount)
  
  // Calculate estimates
  const estimatedCost = calculateCost(job, primary, verifiers)
  const estimatedLatency = calculateLatency(job, primary, verifiers)
  
  return {
    primary,
    verifiers,
    estimatedCost,
    estimatedLatency,
    confidence: calculateConfidence(primary, verifiers)
  }
}

function canHandleJob(peer: GPUPeer, job: InferenceJob, config: MeshLLMConfig): boolean {
  // Check model availability
  if (!peer.models.includes(job.model)) {
    return false
  }
  
  // Check reputation threshold
  if (peer.reputation < config.minReputationScore) {
    return false
  }
  
  // Check if peer has capacity (load < 90%)
  if (peer.load > 0.9) {
    return false
  }
  
  // Check budget constraint
  if (job.budget) {
    const estimatedCost = job.maxTokens * peer.pricing.perToken
    if (estimatedCost > job.budget) {
      return false
    }
  }
  
  return true
}

function sortPeers(peers: GPUPeer[], strategy: RoutingStrategy): GPUPeer[] {
  const sorted = [...peers]
  
  switch (strategy) {
    case 'least-loaded':
      return sorted.sort((a, b) => a.load - b.load)
      
    case 'lowest-cost':
      return sorted.sort((a, b) => a.pricing.perToken - b.pricing.perToken)
      
    case 'highest-reputation':
      return sorted.sort((a, b) => b.reputation - a.reputation)
      
    case 'closest':
      return sorted.sort((a, b) => a.latencyMs - b.latencyMs)
      
    default:
      // Balanced scoring combining multiple factors
      return sorted.sort((a, b) => {
        const scoreA = calculateScore(a)
        const scoreB = calculateScore(b)
        return scoreB - scoreA // Higher score first
      })
  }
}

function calculateScore(peer: GPUPeer): number {
  // Weighted scoring: reputation (40%), load inverse (30%), latency inverse (20%), cost inverse (10%)
  const reputationScore = peer.reputation * 0.4
  const loadScore = (1 - peer.load) * 0.3
  const latencyScore = Math.max(0, 1 - (peer.latencyMs / 1000)) * 0.2
  const costScore = (1 / (1 + peer.pricing.perToken * 1000)) * 0.1
  
  return reputationScore + loadScore + latencyScore + costScore
}

function calculateCost(job: InferenceJob, primary: GPUPeer, verifiers: GPUPeer[]): number {
  const tokens = job.maxTokens
  
  // Primary worker cost
  const primaryCost = tokens * primary.pricing.perToken
  
  // Verifier costs (20% of primary cost distributed)
  const verifierCost = verifiers.reduce((sum, v) => 
    sum + (tokens * v.pricing.perToken * 0.2), 0
  )
  
  // Treasury fee (10%)
  const subtotal = primaryCost + verifierCost
  const treasuryFee = subtotal * 0.1
  
  return Math.ceil(subtotal + treasuryFee)
}

function calculateLatency(job: InferenceJob, primary: GPUPeer, verifiers: GPUPeer[]): number {
  // Base latency: network roundtrip + processing time estimate
  const networkLatency = primary.latencyMs * 2
  
  // Processing estimate: ~50ms per 100 tokens (conservative)
  const processingEstimate = (job.maxTokens / 100) * 50
  
  // Verification latency (parallel, so take max)
  const verificationLatency = verifiers.length > 0 
    ? Math.max(...verifiers.map(v => v.latencyMs * 2))
    : 0
  
  return networkLatency + processingEstimate + verificationLatency
}

function calculateConfidence(primary: GPUPeer, verifiers: GPUPeer[]): number {
  // Confidence based on peer reputation and verifier count
  const baseConfidence = primary.reputation
  const verifierBoost = Math.min(verifiers.length * 0.1, 0.3)
  
  return Math.min(baseConfidence + verifierBoost, 1.0)
}

export function updatePeerLoad(peer: GPUPeer, jobTokens: number): GPUPeer {
  // Simple load model: each inference increases load proportionally
  const loadIncrease = jobTokens / 10000 // 10k tokens = 0.1 load
  return {
    ...peer,
    load: Math.min(peer.load + loadIncrease, 1.0)
  }
}

export function decayPeerLoad(peers: GPUPeer[], decayFactor: number = 0.1): GPUPeer[] {
  return peers.map(p => ({
    ...p,
    load: Math.max(0, p.load - decayFactor)
  }))
}
