export interface ReputationConfig {
  decayRate: number;
  slashPenalty: number;
  minStake: number;
  stakeSlashPercent?: number;
  jumpDetectionWindow?: number;
  jumpThreshold?: number;
}

export interface ReputationScore {
  nodeId: string;
  overall: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  avgQuality: number;
  avgResponseTime: number;
  reliability: number;
  stakeAmount: number;
  slashCount: number;
  skills: Map<string, number>;
  lastActive: Date;
  joinedAt: Date;
}

export interface LeaderboardEntry extends ReputationScore {
  rank: number;
}

export interface NodeMetadata {
  reputationHistory: Array<{ timestamp: Date; score: number }>;
  ipAddress?: string;
  isBanned: boolean;
  reviewFlags: string[];
  totalTaskCount: number;
}
