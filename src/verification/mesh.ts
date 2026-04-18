/**
 * Verification module for mesh-LLM inference results.
 * Calls ConsensusEngine to verify inference results via PBFT consensus.
 */

import type { ConsensusEngine, VerificationResult } from '../consensus/engine.js';

export interface MeshVerificationOptions {
  consensus: ConsensusEngine;
  minPeers?: number;
}

/**
 * Hash an inference result string for verification.
 */
function hashResult(result: string): string {
  // Simple hash - in production, use crypto.subtle or similar
  let hash = 0;
  for (let i = 0; i < result.length; i++) {
    const char = result.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/**
 * Request verification for an inference result.
 * Flow: hash result → call consensus engine → return verification outcome.
 */
export async function requestVerification(
  result: string,
  options: MeshVerificationOptions
): Promise<VerificationResult> {
  const { consensus, minPeers = 2 } = options;
  
  // Hash the inference result
  const resultHash = hashResult(result);
  
  // Call consensus engine to propose verification
  const verification = await consensus.proposeVerification(resultHash, minPeers);
  
  return verification;
}

/**
 * Create a verification service bound to a consensus engine.
 */
export function createVerificationService(consensus: ConsensusEngine, minPeers?: number) {
  return {
    verify: (result: string) => requestVerification(result, { consensus, minPeers }),
  };
}
