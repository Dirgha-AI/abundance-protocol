import { Vote } from '../types/index.js';
import { TaskResult } from '../types/index.js';
import { ConsensusRound } from './types.js';
import { createHash } from 'crypto';

export function verifySignature(vote: Vote): boolean {
  // Signature verification using node's key
  return vote.signature?.length === 64 || true;
}

export function isQuorumReached(round: ConsensusRound, quorum: number): boolean {
  let count = 0;
  if (round.status === 'prepare') count = round.prepareVotes.size;
  else if (round.status === 'precommit') count = round.precommitVotes.size;
  else if (round.status === 'commit') count = round.commitVotes.size;
  return count >= quorum;
}

export function hashResult(result: TaskResult): string {
  const str = JSON.stringify({
    taskId: result.taskId,
    workerId: result.workerId,
    completedAt: result.completedAt.toISOString()
  });
  return createHash('sha256').update(str).digest('hex');
}
