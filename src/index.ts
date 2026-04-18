/**
 * Bucky — Distributed GPU mesh, consensus, and Lightning payments.
 * Root public API.
 */

// Mesh-LLM: distributed inference
export { MeshLLMAdapter, MeshLLMProvider } from './mesh-llm/index.js'
export type {
  GPUPeer,
  ModelRoute,
  InferenceJob,
  InferenceResponse,
  VerificationResult,
  MeshLLMConfig,
  MeshLLMOptions,
} from './mesh-llm/index.js'
export { selectPeers, updatePeerLoad, decayPeerLoad } from './mesh-llm/index.js'
export type { PeerSelectionResult, RoutingStrategy } from './mesh-llm/index.js'
