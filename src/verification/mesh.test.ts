/**
 * Mesh Verification Unit Tests
 * Tests the verification module with mocked ConsensusEngine.
 */

import { describe, it, expect, vi } from 'vitest';
import { requestVerification, createVerificationService } from './mesh.js';
import type { ConsensusEngine, VerificationResult } from '../consensus/engine.js';

// Mock ConsensusEngine factory
function createMockConsensus(overrides: Partial<ConsensusEngine> = {}): ConsensusEngine {
  return {
    proposeVerification: vi.fn(),
    getReputation: vi.fn().mockReturnValue(0.5),
    ...overrides,
  } as unknown as ConsensusEngine;
}

describe('requestVerification', () => {
  it('should return verified=true when 3 nodes agree', async () => {
    const mockConsensus = createMockConsensus({
      proposeVerification: vi.fn().mockResolvedValue({
        verified: true,
        consensusScore: 1.0,
        dissenterCount: 0,
        reputationPenalties: [],
        roundId: 'round-123',
      } as VerificationResult),
    });

    const result = await requestVerification('test inference result', {
      consensus: mockConsensus,
      minPeers: 2,
    });

    expect(result.verified).toBe(true);
    expect(result.consensusScore).toBe(1.0);
    expect(result.dissenterCount).toBe(0);
    expect(mockConsensus.proposeVerification).toHaveBeenCalledWith(
      expect.any(String), // hashed result
      2 // minPeers
    );
  });

  it('should return verified=true with dissenter reputation decremented when 1 of 3 disagrees', async () => {
    const mockConsensus = createMockConsensus({
      proposeVerification: vi.fn().mockResolvedValue({
        verified: true, // Still verified (2/3 quorum)
        consensusScore: 0.67,
        dissenterCount: 1,
        reputationPenalties: ['node-3'], // One dissenter penalized
        roundId: 'round-456',
      } as VerificationResult),
    });

    const result = await requestVerification('test inference result', {
      consensus: mockConsensus,
      minPeers: 2,
    });

    expect(result.verified).toBe(true);
    expect(result.consensusScore).toBe(0.67);
    expect(result.dissenterCount).toBe(1);
    expect(result.reputationPenalties).toContain('node-3');
  });

  it('should return verified=true with score=1.0 in single-node fallback mode', async () => {
    const mockConsensus = createMockConsensus({
      proposeVerification: vi.fn().mockResolvedValue({
        verified: true,
        consensusScore: 1.0,
        dissenterCount: 0,
        reputationPenalties: [],
      } as VerificationResult),
    });

    const result = await requestVerification('test inference result', {
      consensus: mockConsensus,
      minPeers: 2, // minPeers=2 but only 1 node
    });

    // Single-node mode should auto-verify
    expect(result.verified).toBe(true);
    expect(result.consensusScore).toBe(1.0);
    expect(result.dissenterCount).toBe(0);
  });
});

describe('createVerificationService', () => {
  it('should create a service that can verify results', async () => {
    const mockConsensus = createMockConsensus({
      proposeVerification: vi.fn().mockResolvedValue({
        verified: true,
        consensusScore: 0.9,
        dissenterCount: 0,
        reputationPenalties: [],
      } as VerificationResult),
    });

    const service = createVerificationService(mockConsensus, 3);
    const result = await service.verify('inference result');

    expect(result.verified).toBe(true);
    expect(result.consensusScore).toBe(0.9);
    expect(mockConsensus.proposeVerification).toHaveBeenCalledWith(
      expect.any(String),
      3
    );
  });
});
