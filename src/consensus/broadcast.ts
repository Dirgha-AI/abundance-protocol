import { ConsensusEngine } from './engine.js';
import { ConsensusRound } from './types.js';
import { TaskResult } from '../types/index.js';
import { hashResult } from './utils.js';

interface ConsensusMessage {
  type: 'prepare' | 'precommit' | 'commit';
  roundId: string;
  taskId: string;
  result?: TaskResult;
  resultHash?: string;
  nodeId: string;
  timestamp: number;
}

export function broadcastPrepare(
  engine: ConsensusEngine,
  round: ConsensusRound,
  peers: string[],
  nodeId: string
): void {
  const msg: ConsensusMessage = {
    type: 'prepare',
    roundId: round.id,
    taskId: round.taskId,
    result: round.result,
    nodeId,
    timestamp: Date.now()
  };
  engine.emit('broadcast', msg, peers);
}

export function broadcastPrecommit(
  engine: ConsensusEngine,
  round: ConsensusRound,
  peers: string[],
  nodeId: string
): void {
  const msg: ConsensusMessage = {
    type: 'precommit',
    roundId: round.id,
    taskId: round.taskId,
    resultHash: hashResult(round.result),
    nodeId,
    timestamp: Date.now()
  };
  engine.emit('broadcast', msg, peers);
}

export function broadcastCommit(
  engine: ConsensusEngine,
  round: ConsensusRound,
  peers: string[],
  nodeId: string
): void {
  const msg: ConsensusMessage = {
    type: 'commit',
    roundId: round.id,
    taskId: round.taskId,
    resultHash: hashResult(round.result),
    nodeId,
    timestamp: Date.now()
  };
  engine.emit('broadcast', msg, peers);
}
