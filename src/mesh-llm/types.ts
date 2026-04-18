/**
 * Mesh-LLM Types - GPU peer discovery and model routing
 */

export interface GPUPeer {
  peerId: string;
  nodeId: string;
  addresses: string[];
  capabilities: {
    gpu: {
      model: string;
      vram: number;
      cudaCores?: number;
      metalCores?: number;
    };
    cpu: { cores: number; model: string };
    memory: number;
  };
  models: string[];
  load: number;
  latencyMs: number;
  lastSeen: Date;
  reputation: number;
  pricing: {
    perToken: number;
    perSecond: number;
  };
}

export interface ModelRoute {
  model: string;
  peers: GPUPeer[];
  recommended: GPUPeer;
  estimatedCost: number;
  estimatedLatency: number;
}

export interface InferenceJob {
  id: string;
  prompt: string;
  model: string;
  maxTokens: number;
  temperature: number;
  userId: string;
  priority: 'low' | 'normal' | 'high';
  budget?: number;
  requireVerification?: boolean;
  minPeers?: number;
}

export interface InferenceResponse {
  jobId: string;
  content: string;
  tokensGenerated: number;
  tokensPerSecond: number;
  latencyMs: number;
  peerId: string;
  verified: boolean;
  verifications: VerificationResult[];
  cost: number;
  paymentSplit: {
    worker: number;
    verifiers: number;
    treasury: number;
  };
}

export interface VerificationResult {
  verifierId: string;
  peerId: string;
  matches: boolean;
  confidence: number;
  timestamp: Date;
}

export interface MeshLLMConfig {
  discoveryIntervalMs: number;
  healthCheckIntervalMs: number;
  maxConcurrentInferences: number;
  defaultVerificationPeers: number;
  minReputationScore: number;
  routingStrategy: 'least-loaded' | 'lowest-cost' | 'highest-reputation' | 'closest';
  enableAutoScaling: boolean;
  fallbackToLocal: boolean;
}
