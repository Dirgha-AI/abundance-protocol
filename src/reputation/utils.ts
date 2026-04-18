import { ReputationScore, NodeMetadata, ReputationConfig } from './types.js';

export function calculateOverall(score: ReputationScore): number {
  const stakeWeight = Math.min(score.stakeAmount / 100000, 1.0);
  const overall =
    score.successRate * 0.30 +
    score.avgQuality * 0.25 +
    score.reliability * 0.25 +
    stakeWeight * 0.20;
  return Math.max(0, Math.min(1, overall));
}

export function checkReputationJump(
  newScore: number,
  meta: NodeMetadata,
  config: Required<ReputationConfig>
): void {
  const cutoffTime = new Date(
    Date.now() - config.jumpDetectionWindow * 60 * 60 * 1000
  );
  const recentHistory = meta.reputationHistory.filter(
    (h) => h.timestamp >= cutoffTime
  );

  if (recentHistory.length === 0) return;

  const minRecentScore = Math.min(...recentHistory.map((h) => h.score));
  const jump = newScore - minRecentScore;

  if (jump > config.jumpThreshold) {
    meta.reviewFlags.push(
      `Reputation jump: +${jump.toFixed(3)} in ${config.jumpDetectionWindow}h`
    );
  }
}

export function trimHistory(meta: NodeMetadata): void {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  meta.reputationHistory = meta.reputationHistory.filter(
    (h) => h.timestamp > thirtyDaysAgo
  );
}
