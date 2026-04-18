/**
 * Project Bucky Mesh - Reputation System
 * 
 * Critical infrastructure for task allocation, payment eligibility, and slashing.
 * Implements anti-gaming measures including Sybil detection, reputation jump flags,
 * and weighted task validation periods.
 */

export interface ReputationConfig {
  /** Daily decay rate for inactive nodes (e.g., 0.001 = 0.1% per day) */
  decayRate: number;
  /** Reputation points deducted per slash event */
  slashPenalty: number;
  /** Minimum stake required for task eligibility (in sats) */
  minStake: number;
  /** Percentage of stake to burn per slash (default: 0.25) */
  stakeSlashPercent?: number;
  /** Time window for reputation jump detection in hours (default: 24) */
  jumpDetectionWindow?: number;
  /** Threshold for reputation jump flag (default: 0.2) */
  jumpThreshold?: number;
}

export interface ReputationScore {
  /** Unique identifier for the node */
  nodeId: string;
  /** Overall reputation score (0.0 to 1.0) */
  overall: number;
  /** Total number of successfully completed tasks */
  completedTasks: number;
  /** Total number of failed tasks */
  failedTasks: number;
  /** Ratio of completed to total tasks (0.0 to 1.0) */
  successRate: number;
  /** Average quality rating from peers, normalized to 0-1 */
  avgQuality: number;
  /** Average response time in milliseconds */
  avgResponseTime: number;
  /** Uptime percentage (0.0 to 1.0) */
  reliability: number;
  /** Current staked amount in satoshis */
  stakeAmount: number;
  /** Number of times the node has been slashed */
  slashCount: number;
  /** Skill proficiencies mapped by skill name (0.0 to 1.0) */
  skills: Map<string, number>;
  /** Timestamp of last activity */
  lastActive: Date;
  /** Timestamp when node joined the network */
  joinedAt: Date;
}

/** Leaderboard entry with ranking information */
export interface LeaderboardEntry extends ReputationScore {
  /** Current rank (1-indexed) */
  rank: number;
}

/** Internal metadata for anti-gaming and tracking */
interface NodeMetadata {
  /** Historical reputation scores for jump detection */
  reputationHistory: Array<{ timestamp: Date; score: number }>;
  /** IP address for Sybil detection */
  ipAddress?: string;
  /** Whether the node is permanently banned */
  isBanned: boolean;
  /** Active review flags for anti-gaming */
  reviewFlags: string[];
  /** Total task count (completed + failed) for new node weighting */
  totalTaskCount: number;
}

/**
 * Manages reputation scores for Project Bucky mesh nodes.
 * Thread-safe for single-threaded JavaScript execution contexts.
 */
export class ReputationManager {
  public scores: Map<string, ReputationScore>;
  private metadata: Map<string, NodeMetadata>;
  private ipRegistry: Map<string, Set<string>>;
  private config: Required<ReputationConfig>;

  /**
   * Creates a new ReputationManager instance
   * @param config - Configuration parameters for reputation calculation
   */
  constructor(config: ReputationConfig | any) {
    this.config = {
      stakeSlashPercent: 0.25,
      jumpDetectionWindow: 24,
      jumpThreshold: 0.2,
      slashPenalty: 0.1,
      decayRate: 0.001,
      minStake: 0,
      slashThreshold: 3,
      ...config
    } as any;
    
    this.scores = new Map();
    this.metadata = new Map();
    this.ipRegistry = new Map();
  }

  /**
   * Initialize a new node in the reputation system
   * @param nodeId - Unique identifier for the node
   * @param ipAddress - Optional IP address for Sybil detection
   * @returns The initialized reputation score
   */
  initializeNode(nodeId: string, ipAddress?: string): ReputationScore {
    const now = new Date();
    
    const score: ReputationScore = {
      nodeId,
      overall: 0.5, // New nodes start at neutral 0.5
      completedTasks: 0,
      failedTasks: 0,
      successRate: 0,
      avgQuality: 0,
      avgResponseTime: 0,
      reliability: 1.0, // Assume 100% reliability initially
      stakeAmount: 0,
      slashCount: 0,
      skills: new Map(),
      lastActive: now,
      joinedAt: now
    };

    const meta: NodeMetadata = {
      reputationHistory: [{ timestamp: now, score: 0.5 }],
      ipAddress,
      isBanned: false,
      reviewFlags: [],
      totalTaskCount: 0
    };

    this.scores.set(nodeId, score);
    this.metadata.set(nodeId, meta);

    if (ipAddress) {
      this.registerIp(nodeId, ipAddress);
    }

    return score;
  }

  /**
   * Register IP address for a node (used for Sybil detection)
   * @param nodeId - Node identifier
   * @param ipAddress - IP address or CIDR range
   */
  registerNodeIp(nodeId: string, ipAddress: string): void {
    const score = this.scores.get(nodeId);
    if (!score) {
      this.initializeNode(nodeId, ipAddress);
      return;
    }

    const meta = this.metadata.get(nodeId);
    if (meta) {
      // Remove from old IP if exists
      if (meta.ipAddress) {
        const oldSet = this.ipRegistry.get(meta.ipAddress);
        if (oldSet) {
          oldSet.delete(nodeId);
        }
      }
      
      meta.ipAddress = ipAddress;
      this.registerIp(nodeId, ipAddress);
    }
  }

  private registerIp(nodeId: string, ipAddress: string): void {
    if (!this.ipRegistry.has(ipAddress)) {
      this.ipRegistry.set(ipAddress, new Set());
    }
    this.ipRegistry.get(ipAddress)!.add(nodeId);
    this.checkSybilDetection(nodeId, ipAddress);
  }

  /**
   * Detect Sybil attacks by checking for identical capabilities from same IP
   */
  private checkSybilDetection(nodeId: string, ipAddress: string): void {
    const nodesOnIp = this.ipRegistry.get(ipAddress);
    if (!nodesOnIp || nodesOnIp.size < 2) return;

    const currentNode = this.scores.get(nodeId);
    if (!currentNode) return;

    for (const otherId of nodesOnIp) {
      if (otherId === nodeId) continue;
      
      const otherNode = this.scores.get(otherId);
      if (!otherNode) continue;

      // Check for identical skill profiles (indicates copy-paste Sybil)
      if (this.haveIdenticalCapabilities(currentNode.skills, otherNode.skills)) {
        const meta = this.metadata.get(nodeId);
        if (meta && !meta.reviewFlags.includes(`sybil:${ipAddress}`)) {
          meta.reviewFlags.push(`Sybil detection: identical capabilities to ${otherId} from IP ${ipAddress}`);
        }
      }
    }
  }

  private haveIdenticalCapabilities(
    skills1: Map<string, number>, 
    skills2: Map<string, number>
  ): boolean {
    if (skills1.size === 0 && skills2.size === 0) return false; // No skills yet
    if (skills1.size !== skills2.size) return false;

    for (const [skill, level] of skills1) {
      const otherLevel = skills2.get(skill);
      if (otherLevel === undefined) return false;
      if (Math.abs(otherLevel - level) > 0.01) return false; // 1% tolerance
    }
    return true;
  }

  /**
   * Record successful task completion
   * @param nodeId - Node identifier
   * @param quality - Quality rating 1-5 (will be normalized to 0-1)
   * @param responseTime - Response time in milliseconds
   * @param taskType - Type of task (maps to skill name)
   */
  recordTaskCompletion(
    nodeId: string, 
    quality: number, 
    responseTime: number, 
    taskType: string
  ): void {
    let score = this.scores.get(nodeId);
    if (!score) {
      score = this.initializeNode(nodeId);
    }

    const meta = this.metadata.get(nodeId);
    if (!meta || meta.isBanned) return;

    const normalizedQuality = Math.max(0, Math.min(1, quality / 5));
    const isWeightedTask = meta.totalTaskCount < 10;
    const weight = isWeightedTask ? 0.5 : 1.0;

    // Update running averages with weight
    const oldCompleted = score.completedTasks;
    score.completedTasks += 1;
    meta.totalTaskCount += 1;

    // Weighted average for quality
    score.avgQuality = 
      (score.avgQuality * oldCompleted + normalizedQuality * weight) / 
      (oldCompleted + weight);

    // Weighted average for response time
    score.avgResponseTime = 
      (score.avgResponseTime * oldCompleted + responseTime * weight) / 
      (oldCompleted + weight);

    // Update success rate
    const totalTasks = score.completedTasks + score.failedTasks;
    score.successRate = score.completedTasks / totalTasks;

    // Update skill proficiency
    if (taskType) {
      const currentSkill = score.skills.get(taskType) || 0;
      // Exponential moving average for skills
      const skillAlpha = 0.3; // Learning rate
      const newSkill = currentSkill + (normalizedQuality - currentSkill) * skillAlpha * weight;
      score.skills.set(taskType, Math.max(0, Math.min(1, newSkill)));
    }

    score.lastActive = new Date();

    // Recalculate overall with anti-gaming weighting
    const oldOverall = score.overall;
    score.overall = this.calculateOverall(score);
    
    // Apply new node weighting to the delta
    if (isWeightedTask) {
      const delta = score.overall - oldOverall;
      score.overall = oldOverall + (delta * 0.5);
    }

    // Check for reputation jumps
    this.checkReputationJump(nodeId, score.overall, meta);
    
    // Update history
    meta.reputationHistory.push({ timestamp: new Date(), score: score.overall });
    // Trim history to last 30 days to prevent memory bloat
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    meta.reputationHistory = meta.reputationHistory.filter(h => h.timestamp > thirtyDaysAgo);
  }

  /**
   * Record task failure with reason-specific penalties
   * @param nodeId - Node identifier
   * @param reason - Failure reason affecting penalty severity
   */
  recordTaskFailure(
    nodeId: string, 
    reason: 'timeout' | 'incorrect' | 'abandoned'
  ): void {
    let score = this.scores.get(nodeId);
    if (!score) {
      score = this.initializeNode(nodeId);
    }

    const meta = this.metadata.get(nodeId);
    if (!meta || meta.isBanned) return;

    // Reason-specific reputation penalties
    const penalties = {
      timeout: 0.02,      // Network issues, minor penalty
      incorrect: 0.05,    // Wrong result, moderate penalty  
      abandoned: 0.15     // Intentional abandonment, severe penalty
    };

    score.failedTasks += 1;
    meta.totalTaskCount += 1;
    
    const totalTasks = score.completedTasks + score.failedTasks;
    score.successRate = score.completedTasks / totalTasks;
    
    // Apply penalty
    score.overall = Math.max(0, score.overall - penalties[reason]);
    score.lastActive = new Date();

    // Recalculate to ensure consistency
    score.overall = this.calculateOverall(score);
  }

  /**
   * Slash a node for protocol violations
   * @param nodeId - Node to slash
   * @param reason - Reason for slashing (logged for review)
   * @returns boolean indicating if node was banned (3rd slash)
   */
  slash(nodeId: string, amountOrReason: number | string, reason?: string): boolean {
    let score = this.scores.get(nodeId);
    let meta = this.metadata.get(nodeId);
    if (!score) { score = this.initializeNode(nodeId); meta = this.metadata.get(nodeId)!; }
    if (meta?.isBanned) return false;

    let slashAmount: number;
    let slashReason: string;

    if (typeof amountOrReason === 'number') {
      // 3-arg form: slash(nodeId, amount, reason)
      slashAmount = amountOrReason;
      slashReason = reason || 'violation';
    } else {
      // 2-arg form: slash(nodeId, reason) - percentage-based
      slashReason = amountOrReason;
      slashAmount = Math.floor(score.stakeAmount * (this.config as any).stakeSlashPercent);
    }

    // Burn stake
    score.stakeAmount = Math.max(0, score.stakeAmount - slashAmount);

    // Apply reputation penalty
    score.slashCount += 1;
    score.overall = Math.max(0, score.overall - (this.config as any).slashPenalty);

    // Add review flag
    meta?.reviewFlags.push(`Slash #${score.slashCount}: ${slashReason} (-${slashAmount} sats)`);

    // Permanent ban after slashThreshold slashes
    const threshold = (this.config as any).slashThreshold ?? 3;
    if (score.slashCount >= threshold) {
      if (meta) meta.isBanned = true;
      score.overall = 0;
      return true;
    }

    score.lastActive = new Date();
    return false;
  }

  /**
   * Check for sudden reputation jumps (>0.2 in 24 hours)
   */
  private checkReputationJump(
    nodeId: string, 
    newScore: number, 
    meta: NodeMetadata
  ): void {
    const windowHours = this.config.jumpDetectionWindow;
    const threshold = this.config.jumpThreshold;
    
    const cutoffTime = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const recentHistory = meta.reputationHistory.filter(h => h.timestamp >= cutoffTime);
    
    if (recentHistory.length === 0) return;
    
    const minRecentScore = Math.min(...recentHistory.map(h => h.score));
    const jump = newScore - minRecentScore;
    
    if (jump > threshold) {
      meta.reviewFlags.push(
        `Reputation jump detected: +${jump.toFixed(3)} in ${windowHours}h`
      );
    }
  }

  /**
   * Calculate overall reputation score using weighted formula
   * Formula: successRate(30%) + avgQuality(25%) + reliability(25%) + stakeWeight(20%)
   */
  calculateOverall(score: ReputationScore): number {
    const stakeWeight = Math.min(score.stakeAmount / 100000, 1.0);
    
    const overall = 
      (score.successRate * 0.30) +
      (score.avgQuality * 0.25) +
      (score.reliability * 0.25) +
      (stakeWeight * 0.20);
    
    return Math.max(0, Math.min(1, overall));
  }

  /**
   * Get reputation score for a node
   * @param nodeId - Node identifier
   * @returns ReputationScore or undefined if not found/banned
   */
  getScore(nodeId: string): ReputationScore | undefined {
    const score = this.scores.get(nodeId);
    const meta = this.metadata.get(nodeId);
    
    if (!score || !meta || meta.isBanned) return undefined;
    return score;
  }

  /**
   * Get top N nodes by reputation, optionally filtered by skill
   * @param n - Number of nodes to return
   * @param skill - Optional skill filter (returns nodes with proficiency > 0.5)
   * @returns Array of top reputation scores
   */
  getTopNodes(n: number, skill?: string): ReputationScore[] {
    let candidates: ReputationScore[] = [];
    
    for (const [nodeId, score] of this.scores) {
      const meta = this.metadata.get(nodeId);
      if (!meta || meta.isBanned) continue;
      
      if (skill) {
        const proficiency = score.skills.get(skill) || 0;
        if (proficiency < 0.5) continue; // Must have at least 50% proficiency
      }
      
      candidates.push(score);
    }
    
    return candidates
      .sort((a, b) => b.overall - a.overall)
      .slice(0, n);
  }

  /**
   * Check if node is eligible for tasks
   * @param nodeId - Node identifier
   * @param minReputation - Minimum overall score required
   * @returns boolean indicating eligibility
   */
  isEligible(nodeId: string, minReputation: number): boolean {
    const score = this.scores.get(nodeId);
    const meta = this.metadata.get(nodeId);
    
    if (!score || !meta) return false;
    if (meta.isBanned) return false;
    if (score.overall < minReputation) return false;
    if (score.stakeAmount < this.config.minStake) return false;
    if (meta.reviewFlags.length > 5) return false; // Too many flags
    
    return true;
  }

  /**
   * Apply time-based decay to inactive nodes
   * Should be called periodically (e.g., once per hour)
   */
  decayScores(): void {
    const now = new Date();
    
    for (const [nodeId, score] of this.scores) {
      const meta = this.metadata.get(nodeId);
      if (!meta || meta.isBanned) continue;
      
      const daysInactive = (now.getTime() - score.lastActive.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysInactive > 1) {
        // Linear decay per day of inactivity
        const decayAmount = Math.floor(daysInactive) * this.config.decayRate;
        score.overall = Math.max(0, score.overall - decayAmount);
      }
    }
  }

  /**
   * Get leaderboard with rankings
   * @param limit - Maximum number of entries to return
   * @returns Array of leaderboard entries with rank
   */
  getLeaderboard(limit: number): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    let rank = 1;
    
    // Get all non-banned nodes sorted by overall
    const sorted = Array.from(this.scores.entries())
      .filter(([nodeId]) => {
        const meta = this.metadata.get(nodeId);
        return meta && !meta.isBanned;
      })
      .sort((a, b) => b[1].overall - a[1].overall);
    
    for (const [, score] of sorted) {
      entries.push({
        ...score,
        rank: rank++
      });
      
      if (entries.length >= limit) break;
    }
    
    return entries;
  }

  /**
   * Update node stake amount
   * @param nodeId - Node identifier
   * @param amount - New stake amount in sats
   */
  updateStake(nodeId: string, amount: number): void {
    let score = this.scores.get(nodeId);
    if (!score) {
      score = this.initializeNode(nodeId);
    }
    
    score.stakeAmount = Math.max(0, amount);
    score.overall = this.calculateOverall(score);
    score.lastActive = new Date();
  }

  /**
   * Update node reliability (uptime percentage)
   * @param nodeId - Node identifier  
   * @param uptimePercent - Uptime percentage (0.0 to 1.0)
   */
  updateReliability(nodeId: string, uptimePercent: number): void {
    let score = this.scores.get(nodeId);
    if (!score) {
      score = this.initializeNode(nodeId);
    }
    
    score.reliability = Math.max(0, Math.min(1, uptimePercent));
    score.overall = this.calculateOverall(score);
  }

  /**
   * Get review flags for a node (anti-gaming alerts)
   * @param nodeId - Node identifier
   * @returns Array of review flag strings
   */
  getReviewFlags(nodeId: string): string[] {
    const meta = this.metadata.get(nodeId);
    return meta ? [...meta.reviewFlags] : [];
  }

  // Compatibility API
  getReputation(nodeId: string): { overall: number; stake: number; slashCount: number; tasksCompleted: number; tasksFailed: number; status: string } {
    let score = this.scores.get(nodeId);
    if (!score) score = this.initializeNode(nodeId);
    const meta = this.metadata.get(nodeId);
    return {
      overall: score.overall,
      stake: score.stakeAmount,
      slashCount: score.slashCount,
      tasksCompleted: score.completedTasks,
      tasksFailed: score.failedTasks,
      status: (meta?.isBanned) ? 'banned' : 'active',
    };
  }

  stakeNode(nodeId: string, amount: number): void {
    let score = this.scores.get(nodeId);
    if (!score) score = this.initializeNode(nodeId);
    score.stakeAmount = (score.stakeAmount || 0) + amount;
  }

  /**
   * Check if a node is permanently banned
   * @param nodeId - Node identifier
   */
  isBanned(nodeId: string): boolean {
    const meta = this.metadata.get(nodeId);
    return meta ? meta.isBanned : false;
  }
}

/**
 * Factory function to create a ReputationManager instance
 * @param config - Configuration for the reputation system
 * @returns ReputationManager instance
 */
export function createReputationManager(config: ReputationConfig): ReputationManager {
  return new ReputationManager(config);
}
