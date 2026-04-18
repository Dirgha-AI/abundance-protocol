export type TaskType =
  | 'compute_cpu' | 'compute_gpu' | 'ml_training'
  | 'ml_inference' | 'code_review' | 'agent_execution';

export type TaskStatus =
  | 'posted' | 'assigned' | 'running' | 'verifying' | 'verified'
  | 'completed' | 'failed' | 'disputed';

export type LightningConfigType = 'strike' | 'lnd' | 'ldk' | 'breez' | 'cln';

export interface NodeCapabilities {
  cpu: { cores: number; model: string };
  gpu?: { model: string; vram: number; cudaCores?: number };
  memory: number; storage: number; bandwidth: number;
}

export interface ReputationScore {
  nodeId: string; overall: number; completedTasks: number; failedTasks: number;
  successRate: number; avgQuality: number; avgResponseTime: number;
  reliability: number; stakeAmount: number; slashCount: number;
  skills: Map<string, number>; lastActive: Date; joinedAt: Date;
}

export interface LeaderboardEntry extends ReputationScore { rank: number; }

export interface TaskRequirements {
  minCpu?: number; minGpu?: string; minMemory?: number;
  minBandwidth?: number; maxDuration?: number; requiredReputation?: number;
}

export interface MeshTask {
  taskId: string; posterId: string; type: TaskType; description: string;
  requirements: TaskRequirements; budget: number; status: TaskStatus; createdAt: Date;
}

export interface TaskMetrics { cpuSeconds: number; gpuSeconds: number; memoryMB: number; }

export interface TaskResult {
  taskId: string; workerId: string; output: string | Buffer;
  metrics: TaskMetrics; completedAt: Date;
}

export interface TaskBid { taskId: string; bidderId: string; stakeAmount: number; timestamp: Date; }

export interface Vote {
  roundId: string; nodeId: string; type: 'prepare' | 'precommit' | 'commit';
  resultHash?: string; timestamp?: number; signature: string;
}

export interface ConsensusVote { roundId: string; nodeId: string; value: boolean; signature: string; }
export interface ConsensusMessage { type: string; roundId: string; senderId?: string; nodeId?: string; taskId?: string; result?: unknown; resultHash?: string; timestamp?: number; payload?: unknown; }

export interface ConsensusResult {
  roundId: string; taskId: string;
  verified?: boolean; status?: string;
  nodeCount: number; approvedBy?: string[];
  result?: unknown;
}

export interface LightningConfig {
  type: LightningConfigType; endpoint?: string; apiKey?: string; apiSecret?: string; walletPath?: string;
}

export interface InvoiceResult { paymentHash: string; paymentRequest: string; amount: number; expiresAt: string; }
export interface PaymentResult { success: boolean; paymentHash: string; error?: string; }
export interface Transaction { id: string; amount: number; type: 'incoming' | 'outgoing'; timestamp: Date; }

export interface UpstreamPayment { dependencyId: string; amount: number; level: 1 | 2 | 3; }
export interface PaymentSplit { worker: number; upstream: UpstreamPayment[]; treasury: number; }

export interface PeerInfo { id?: string; nodeId?: string; peerId?: string; addresses: string[]; capabilities?: NodeCapabilities; timestamp?: number; }

export interface MeshConfig {
  nodeId: string; listenPort: number; bootstrapPeers: string[];
  stakeAmount: number; capabilities: NodeCapabilities; lightning: LightningConfig;
}
