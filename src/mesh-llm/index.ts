/**
 * Mesh-LLM Module - Distributed GPU inference for Bucky
 * 
 * @example
 * ```typescript
 * import { MeshLLMAdapter } from '@dirgha/bucky/mesh-llm'
 * 
 * const adapter = new MeshLLMAdapter({
 *   buckyNode,
 *   consensus,
 *   lightning,
 *   config: { routingStrategy: 'least-loaded' }
 * })
 * 
 * await adapter.start()
 * 
 * const result = await adapter.routeInference({
 *   id: 'job-123',
 *   prompt: 'Write a poem',
 *   model: 'gemma-4',
 *   maxTokens: 2048,
 *   temperature: 0.7,
 *   userId: 'user-456'
 * })
 * ```
 */

export * from './types.js'
export * from './routing.js'
export * from './adapter.js'
export * from './provider.js'

// Re-export main classes for convenience
export { MeshLLMAdapter } from './adapter.js'
export { MeshLLMProvider } from './provider.js'
