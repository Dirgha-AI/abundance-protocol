import { ReputationScore, NodeMetadata, ReputationConfig } from './types.js';
import { calculateOverall, checkReputationJump, trimHistory } from './utils.js';

export function initializeNode(
  nodeId: string,
  ipAddress: string | undefined,
  scores: Map<string, ReputationScore>,
  metadata: Map<string, NodeMetadata>
): ReputationScore {
  const now = new Date();

  const score: ReputationScore = {
    nodeId,
    overall: 0.5,
    completedTasks: 0,
    failedTasks: 0,
    successRate: 0,
    avgQuality: 0,
    avgResponseTime: 0,
    reliability: 1.0,
    stakeAmount: 0,
    slashCount: 0,
    skills: new Map(),
    lastActive: now,
    joinedAt: now,
  };

  const meta: NodeMetadata = {
    reputationHistory: [{ timestamp: now, score: 0.5 }],
    ipAddress,
    isBanned: false,
    reviewFlags: [],
    totalTaskCount: 0,
  };

  scores.set(nodeId, score);
  metadata.set(nodeId, meta);

  return score;
}

export function recordTaskCompletion(
  score: ReputationScore,
  meta: NodeMetadata,
  quality: number,
  responseTime: number,
  taskType: string
): void {
  const normalizedQuality = Math.max(0, Math.min(1, quality / 5));
  const isWeightedTask = meta.totalTaskCount < 10;
  const weight = isWeightedTask ? 0.5 : 1.0;

  const oldCompleted = score.completedTasks;
  score.completedTasks += 1;
  meta.totalTaskCount += 1;

  score.avgQuality =
    (score.avgQuality * oldCompleted + normalizedQuality * weight) /
    (oldCompleted + weight);

  score.avgResponseTime =
    (score.avgResponseTime * oldCompleted + responseTime * weight) /
    (oldCompleted + weight);

  const totalTasks = score.completedTasks + score.failedTasks;
  score.successRate = score.completedTasks / totalTasks;

  if (taskType) {
    const currentSkill = score.skills.get(taskType) || 0;
    const skillAlpha = 0.3;
    const newSkill =
      currentSkill + (normalizedQuality - currentSkill) * skillAlpha * weight;
    score.skills.set(taskType, Math.max(0, Math.min(1, newSkill)));
  }

  score.lastActive = new Date();
  const oldOverall = score.overall;
  score.overall = calculateOverall(score);

  if (isWeightedTask) {
    const delta = score.overall - oldOverall;
    score.overall = oldOverall + delta * 0.5;
  }

  meta.reputationHistory.push({ timestamp: new Date(), score: score.overall });
  trimHistory(meta);
}

export function recordTaskFailure(
  score: ReputationScore,
  meta: NodeMetadata,
  reason: 'timeout' | 'incorrect' | 'abandoned'
): void {
  const penalties = { timeout: 0.02, incorrect: 0.05, abandoned: 0.15 };

  score.failedTasks += 1;
  meta.totalTaskCount += 1;

  const totalTasks = score.completedTasks + score.failedTasks;
  score.successRate = score.completedTasks / totalTasks;

  score.overall = Math.max(0, score.overall - penalties[reason]);
  score.overall = calculateOverall(score);
}
