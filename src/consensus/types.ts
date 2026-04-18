import { TaskResult, Vote } from '../types/index.js';

export type RoundStatus = 'prepare' | 'precommit' | 'commit' | 'committed' | 'failed';

export interface ConsensusRound {
  id: string;
  taskId: string;
  result: TaskResult;
  status: RoundStatus;
  prepareVotes: Map<string, Vote>;
  precommitVotes: Map<string, Vote>;
  commitVotes: Map<string, Vote>;
  createdAt: number;
  timeoutId?: NodeJS.Timeout;
}
