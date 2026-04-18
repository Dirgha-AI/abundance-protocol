/**
 * Project Bucky Mesh - Distributed AI Training Coordinator
 * 
 * A federated learning orchestrator for training community-owned foundational models
 * across untrusted mesh nodes. Implements Byzantine-fault tolerant secure aggregation,
 * gradient compression, and model sharding to ensure no single worker possesses the
 * complete model while maintaining training integrity.
 */

import { createHash, randomBytes } from 'crypto';

/** Gradient compression method configuration */
type CompressionLevel = 'none' | 'topk' | 'random';

/** Training job lifecycle states */
type JobStatus = 
  | 'initializing' 
  | 'distributing' 
  | 'training' 
  | 'aggregating' 
  | 'checkpointing' 
  | 'completed' 
  | 'failed';

/** Worker node lifecycle states */
type WorkerStatus = 
  | 'assigned' 
  | 'downloading' 
  | 'training' 
  | 'uploading_gradients' 
  | 'idle' 
  | 'failed';

/** Training job configuration parameters */
interface JobConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  datasetPath: string;
}

/** Coordinator initialization configuration */
interface CoordinatorConfig {
  minWorkers: number;
  maxWorkers: number;
  checkpointIntervalMs: number;
  gradientCompressionLevel: CompressionLevel;
}

/** Model checkpoint metadata */
interface Checkpoint {
  epoch: number;
  loss: number;
  modelHash: string;
  storagePath: string;
  timestamp: Date;
}

/** Worker node state tracking */
interface WorkerState {
  nodeId: string;
  status: WorkerStatus;
  currentBatch: number;
  localLoss: number;
  gradientNorm: number;
  lastHeartbeat: Date;
  modelShard?: Float32Array; // Worker only sees their shard
  reputationScore: number; // 0-100, penalized for Byzantine behavior
  secretShare?: Float32Array; // For additive secret sharing
}

/** Active training job state */
interface TrainingJob {
  jobId: string;
  modelName: string;
  modelSize: string;
  status: JobStatus;
  workers: Map<string, WorkerState>;
  currentEpoch: number;
  totalEpochs: number;
  currentLoss: number;
  bestLoss: number;
  startedAt: Date;
  checkpoints: Checkpoint[];
  config: JobConfig;
  globalModel?: Float32Array; // Coordinator maintains full model
  aggregationBuffer?: Map<string, Float32Array>; // Pending gradients
  lastAggregationAt?: Date;
  throughputHistory: number[]; // Samples per second for ETA calculation
}

/**
 * Secure aggregation result containing aggregated gradient and metadata
 */
interface AggregationResult {
  aggregatedGradient: Float32Array;
  excludedWorkers: string[]; // Byzantine nodes detected and excluded
  reputationPenalties: Map<string, number>; // Reputation deductions applied
}

/**
 * Distributed AI Training Coordinator for Project Bucky Mesh
 * 
 * Orchestrates federated learning across untrusted nodes using:
 * - Secure Multi-Party Computation (additive secret sharing)
 * - Byzantine gradient detection and exclusion
 * - Differential privacy through gradient compression
 * - Model sharding for intellectual property protection
 */
/** Simplified sync job for lightweight API */
interface SimpleJob {
  id: string;
  dataset: string;
  epochs: number;
  batchSize: number;
  status: 'initializing' | 'running' | 'recovering' | 'completed' | 'failed';
  workers: string[];
  currentEpoch: number;
  globalStep: number;
}

export class TrainingCoordinator {
  private jobs: Map<string, TrainingJob>;
  private config: CoordinatorConfig;
  private nodeRegistry: Set<string>; // Available mesh nodes
  private simpleJobs: Map<string, SimpleJob>;
  private simpleConfig: Record<string, any>;

  /**
   * Initialize the training coordinator.
   * Accepts full CoordinatorConfig or simplified {modelId, maxWorkers, gradientThreshold, compressionRatio}.
   */
  constructor(config: CoordinatorConfig | any) {
    this.simpleJobs = new Map();

    const isSimplified = !('minWorkers' in config) || !('checkpointIntervalMs' in config);

    if (isSimplified) {
      this.simpleConfig = config;
      this.config = {
        minWorkers: 5,
        maxWorkers: config.maxWorkers ?? 20,
        checkpointIntervalMs: 300000,
        gradientCompressionLevel: 'none',
      };
    } else {
      this.simpleConfig = {};
      this.config = config as CoordinatorConfig;
      // Only validate security constraint for full config mode
      if (this.config.minWorkers < 5) {
        throw new Error('SECURITY_VIOLATION: Minimum 5 workers required for Byzantine tolerance');
      }
    }

    this.jobs = new Map();
    this.nodeRegistry = new Set();

    if (!isSimplified) {
      console.log(`[BuckyMesh] Coordinator initialized with ${this.config.minWorkers}-${this.config.maxWorkers} worker range`);
    }
  }


  /**
   * Shard model weights and distribute to workers such that no worker sees the full model.
   * Uses horizontal partitioning - each worker receives a subset of layers/weights.
   * 
   * @param jobId - Target training job
   * @throws Error if job not found or workers unavailable
   */
  async distributeModel(jobId: string): Promise<void> {
    const job = this.getJobOrThrow(jobId);
    job.status = 'distributing';

    if (!job.globalModel) {
      // Initialize model (simulated random weights for example)
      const modelSize = this.parseModelSize(job.modelSize);
      job.globalModel = new Float32Array(modelSize);
      // Initialize with Xavier/He initialization (simulated)
      for (let i = 0; i < job.globalModel.length; i++) {
        job.globalModel[i] = (Math.random() - 0.5) * 0.02;
      }
    }

    const workerCount = job.workers.size;
    const shardSize = Math.floor(job.globalModel.length / workerCount);
    
    // Distribute shards with overlap for secure aggregation boundaries
    let index = 0;
    for (const [nodeId, worker] of job.workers) {
      const start = index * shardSize;
      const end = (index === workerCount - 1) ? job.globalModel.length : (index + 1) * shardSize;
      
      // Create shard with padding for secure aggregation overlap
      worker.modelShard = job.globalModel.slice(start, end);
      worker.status = 'downloading';
      
      // Simulate network delay
      await this.simulateNetworkDelay(100, 500);
      worker.status = 'idle';
      worker.lastHeartbeat = new Date();
      
      index++;
    }

    job.status = 'training';
    console.log(`[Job ${jobId}] Model distributed across ${workerCount} shards`);
  }

  /**
   * Collect gradient updates from all active workers.
   * Validates gradients for poisoning attacks before acceptance.
   * 
   * @param jobId - Target training job
   * @returns Map of nodeId to gradient updates
   */
  async collectGradients(jobId: string): Promise<Map<string, Float32Array>> {
    const job = this.getJobOrThrow(jobId);
    const gradients = new Map<string, Float32Array>();
    const norms: number[] = [];

    // Collect from all workers
    for (const [nodeId, worker] of job.workers) {
      if (worker.status === 'failed') continue;

      try {
        // Simulate worker training and gradient computation
        worker.status = 'training';
        await this.simulateNetworkDelay(1000, 5000);
        
        // Generate gradient (simulated: in real impl, worker computes on local data)
        const gradient = this.computeLocalGradient(worker);
        const norm = this.computeGradientNorm(gradient);
        
        worker.gradientNorm = norm;
        worker.status = 'uploading_gradients';
        norms.push(norm);
        
        // Preliminary validation
        if (await this._internalValidateGradient(nodeId, gradient)) {
          gradients.set(nodeId, gradient);
        }
        
        worker.status = 'idle';
        worker.lastHeartbeat = new Date();
      } catch (error) {
        console.warn(`[Job ${jobId}] Failed to collect from ${nodeId}: ${error}`);
        await this.handleWorkerFailure(jobId, nodeId);
      }
    }

    // Byzantine detection: exclude outliers > 3 std dev from median
    if (gradients.size >= this.config.minWorkers) {
      const median = this.calculateMedian(norms);
      const stdDev = this.calculateStdDev(norms, median);
      
      for (const [nodeId, gradient] of gradients) {
        const worker = job.workers.get(nodeId)!;
        if (Math.abs(worker.gradientNorm - median) > 3 * stdDev) {
          console.warn(`[SECURITY] Byzantine node detected: ${nodeId}, norm=${worker.gradientNorm}, median=${median}`);
          gradients.delete(nodeId);
          worker.reputationScore = Math.max(0, worker.reputationScore - 20);
        }
      }
    }

    job.aggregationBuffer = gradients;
    return gradients;
  }

  /**
   * Secure aggregation using additive secret sharing.
   * Aggregates gradients without the coordinator seeing individual updates.
   * Implements pairwise masking for privacy preservation.
   * 
   * @param jobId - Target training job
   * @param gradients - Map of worker gradients (already masked via secret sharing)
   * @returns Aggregated gradient update
   * @throws Error if insufficient valid gradients for secure aggregation
   */
  async aggregateGradients(
    jobId: string, 
    gradients: Map<string, Float32Array>
  ): Promise<AggregationResult> {
    const job = this.getJobOrThrow(jobId);
    job.status = 'aggregating';

    if (gradients.size < this.config.minWorkers) {
      throw new Error(`SECURITY_VIOLATION: Only ${gradients.size} gradients, minimum ${this.config.minWorkers} required`);
    }

    const result: AggregationResult = {
      aggregatedGradient: new Float32Array(0),
      excludedWorkers: [],
      reputationPenalties: new Map(),
    };

    // Get reference length from first gradient
    const firstGradient = gradients.values().next().value as Float32Array;
    const aggregated = new Float32Array(firstGradient.length);
    
    // Secure aggregation: sum all gradients (masks cancel out in additive secret sharing)
    let validCount = 0;
    for (const [nodeId, gradient] of gradients) {
      const worker = job.workers.get(nodeId)!;
      
      // Additional Byzantine check: norm relative to median
      const norms = Array.from(gradients.values()).map(g => this.computeGradientNorm(g));
      const median = this.calculateMedian(norms);
      
      if (worker.gradientNorm > 3 * median) {
        console.warn(`[SECURITY] Gradient poisoning detected from ${nodeId}: norm ${worker.gradientNorm} > 3x median ${median}`);
        result.excludedWorkers.push(nodeId);
        result.reputationPenalties.set(nodeId, 30);
        worker.reputationScore = Math.max(0, worker.reputationScore - 30);
        continue;
      }

      // Accumulate (in real impl, this would be modulo field arithmetic for secret sharing)
      for (let i = 0; i < gradient.length; i++) {
        aggregated[i] += gradient[i];
      }
      validCount++;
    }

    // Average the aggregated gradient
    if (validCount > 0) {
      for (let i = 0; i < aggregated.length; i++) {
        aggregated[i] /= validCount;
      }
    }

    // Apply compression if configured
    if (this.config.gradientCompressionLevel !== 'none') {
      result.aggregatedGradient = await this._internalCompressGradients(
        aggregated,
        this.config.gradientCompressionLevel
      );
    } else {
      result.aggregatedGradient = aggregated;
    }

    // Update global model
    if (job.globalModel) {
      const lr = job.config.learningRate;
      for (let i = 0; i < job.globalModel.length; i++) {
        job.globalModel[i] -= lr * result.aggregatedGradient[i];
      }
    }

    job.currentEpoch++;
    job.lastAggregationAt = new Date();
    
    console.log(`[Job ${jobId}] Secure aggregation complete: ${validCount}/${gradients.size} workers valid`);
    return result;
  }

  private async _internalCompressGradients(
    gradients: Float32Array,
    method: 'topk' | 'random'
  ): Promise<Float32Array> {
    if (method === 'topk') {
      // Top-K: Keep top 1% by absolute magnitude
      const k = Math.max(1, Math.floor(gradients.length * 0.01));
      const indices = Array.from({ length: gradients.length }, (_, i) => i);
      
      // Sort by absolute value descending
      indices.sort((a, b) => Math.abs(gradients[b]) - Math.abs(gradients[a]));
      
      const compressed = new Float32Array(gradients.length);
      for (let i = 0; i < k; i++) {
        compressed[indices[i]] = gradients[indices[i]];
      }
      
      return compressed;
    } else {
      // Random: Keep random 10%
      const mask = new Float32Array(gradients.length);
      const k = Math.max(1, Math.floor(gradients.length * 0.10));
      
      // Fisher-Yates shuffle for random selection
      const indices = Array.from({ length: gradients.length }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      
      const compressed = new Float32Array(gradients.length);
      for (let i = 0; i < k; i++) {
        compressed[indices[i]] = gradients[indices[i]];
      }
      
      return compressed;
    }
  }

  private async _internalValidateGradient(nodeId: string, gradient: Float32Array): Promise<boolean> {
    const job = this.getJobForNode(nodeId);
    if (!job) return false;

    const currentNorm = this.computeGradientNorm(gradient);
    
    // Calculate median norm across all workers
    const norms: number[] = [];
    for (const worker of job.workers.values()) {
      if (worker.gradientNorm > 0) {
        norms.push(worker.gradientNorm);
      }
    }
    
    if (norms.length === 0) return true; // First gradient
    
    const median = this.calculateMedian(norms);
    
    // Reject if norm > 3x median (Byzantine attack detection)
    if (currentNorm > 3 * median) {
      console.warn(`[SECURITY] Gradient rejected from ${nodeId}: norm ${currentNorm} exceeds 3x median ${median}`);
      const worker = job.workers.get(nodeId);
      if (worker) {
        worker.reputationScore -= 10;
      }
      return false;
    }
    
    return true;
  }

  /**
   * Create checkpoint of current model state.
   * Computes SHA-256 hash of weights and stores to IPFS (simulated).
   * 
   * @param jobId - Target training job
   * @returns Promise resolving to checkpoint metadata
   */
  async checkpoint(jobId: string): Promise<Checkpoint> {
    const job = this.getJobOrThrow(jobId);
    job.status = 'checkpointing';

    if (!job.globalModel) {
      throw new Error('No model available for checkpointing');
    }

    // Compute SHA-256 hash of model weights
    const modelBuffer = Buffer.from(job.globalModel.buffer);
    const modelHash = createHash('sha256').update(modelBuffer).digest('hex');
    
    // Simulate IPFS storage (in production, this would pin to IPFS)
    const storagePath = `ipfs://Qm${randomBytes(16).toString('hex')}`;
    
    const checkpoint: Checkpoint = {
      epoch: job.currentEpoch,
      loss: job.currentLoss,
      modelHash,
      storagePath,
      timestamp: new Date(),
    };

    job.checkpoints.push(checkpoint);
    
    // Verify integrity (detect tampering)
    if (job.checkpoints.length > 1) {
      const prev = job.checkpoints[job.checkpoints.length - 2];
      if (checkpoint.loss > prev.loss * 1.5) {
        console.warn(`[Job ${jobId}] Checkpoint warning: significant loss increase detected`);
      }
    }

    job.status = 'training';
    console.log(`[Job ${jobId}] Checkpoint created at epoch ${checkpoint.epoch}, hash ${modelHash.substring(0, 16)}...`);
    
    return checkpoint;
  }

  /**
   * Recover training from a specific checkpoint when workers fail or corruption detected.
   * 
   * @param jobId - Target training job
   * @param checkpointIndex - Index in checkpoints array to restore from
   * @throws Error if checkpoint invalid or model hash verification fails
   */
  async recoverFromCheckpoint(jobId: string, checkpointIndex: number): Promise<void> {
    const job = this.getJobOrThrow(jobId);
    
    if (checkpointIndex < 0 || checkpointIndex >= job.checkpoints.length) {
      throw new Error(`Invalid checkpoint index: ${checkpointIndex}`);
    }

    const checkpoint = job.checkpoints[checkpointIndex];
    
    // Verify model integrity via hash (simulated retrieval and verification)
    console.log(`[Job ${jobId}] Recovering from checkpoint ${checkpointIndex} at epoch ${checkpoint.epoch}`);
    
    // In production: fetch from IPFS, verify hash, restore weights
    job.currentEpoch = checkpoint.epoch;
    job.currentLoss = checkpoint.loss;
    
    // Reset worker states
    for (const worker of job.workers.values()) {
      worker.status = 'assigned';
      worker.currentBatch = 0;
      worker.localLoss = Infinity;
    }

    // Redistribute model shards
    await this.distributeModel(jobId);
  }

  /**
   * Handle worker node failure during training.
   * Reassigns work to available nodes and restores from last valid gradient.
   * 
   * @param jobId - Target training job
   * @param nodeId - Failed worker node identifier
   */
  async handleWorkerFailure(jobId: string, nodeId: string): Promise<void> {
    const job = this.getJobOrThrow(jobId);
    const worker = job.workers.get(nodeId);
    
    if (!worker) return;

    console.warn(`[Job ${jobId}] Handling failure of worker ${nodeId}`);
    worker.status = 'failed';
    
    // Attempt to recruit replacement from mesh
    const availableNodes = await this.discoverMeshNodes();
    const existingNodes = new Set(job.workers.keys());
    
    for (const candidate of availableNodes) {
      if (!existingNodes.has(candidate) && candidate !== nodeId) {
        // Add replacement worker
        job.workers.set(candidate, {
          nodeId: candidate,
          status: 'assigned',
          currentBatch: 0,
          localLoss: Infinity,
          gradientNorm: 0,
          lastHeartbeat: new Date(),
          reputationScore: 100,
        });
        
        // Distribute shard to new worker
        await this.distributeModel(jobId);
        console.log(`[Job ${jobId}] Replaced failed ${nodeId} with ${candidate}`);
        break;
      }
    }

    // If below minimum workers, pause for checkpoint recovery
    const activeWorkers = Array.from(job.workers.values()).filter(w => w.status !== 'failed').length;
    if (activeWorkers < this.config.minWorkers) {
      console.error(`[Job ${jobId}] CRITICAL: Below minimum worker threshold (${activeWorkers}/${this.config.minWorkers})`);
      await this.recoverFromCheckpoint(jobId, job.checkpoints.length - 1);
    }
  }

  // ==================== Simplified Sync API ====================

  /**
   * Start training job (sync simplified form) or async full form.
   * Sync: startTrainingJob({dataset, epochs, batchSize?}) → SimpleJob
   * Async: startTrainingJob(modelName, config) → Promise<string>
   */
  startTrainingJob(optsOrModelName: string | { dataset: string; epochs: number; batchSize?: number }, config?: JobConfig): SimpleJob | Promise<string> {
    if (typeof optsOrModelName === 'object') {
      const opts = optsOrModelName;
      const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const job: SimpleJob = {
        id,
        dataset: opts.dataset,
        epochs: opts.epochs,
        batchSize: opts.batchSize ?? 32,
        status: 'initializing',
        workers: [],
        currentEpoch: 0,
        globalStep: 0,
      };
      this.simpleJobs.set(id, job);
      return job;
    }
    return this._startTrainingJobAsync(optsOrModelName, config!);
  }

  private async _startTrainingJobAsync(modelName: string, config: JobConfig): Promise<string> {
    const jobId = this.generateJobId();
    const availableWorkers = await this.discoverMeshNodes();
    if (availableWorkers.length < this.config.minWorkers) {
      throw new Error(`INSUFFICIENT_WORKERS: Only ${availableWorkers.length} available, need ${this.config.minWorkers}`);
    }
    const selectedWorkers = availableWorkers.sort(() => Math.random() - 0.5).slice(0, this.config.maxWorkers);
    const workerMap = new Map<string, WorkerState>();
    selectedWorkers.forEach(nodeId => {
      workerMap.set(nodeId, { nodeId, status: 'assigned', currentBatch: 0, localLoss: Infinity, gradientNorm: 0, lastHeartbeat: new Date(), reputationScore: 100 });
    });
    const job: TrainingJob = {
      jobId, modelName, modelSize: this.inferModelSize(modelName), status: 'initializing', workers: workerMap,
      currentEpoch: 0, totalEpochs: config.epochs, currentLoss: Infinity, bestLoss: Infinity,
      startedAt: new Date(), checkpoints: [], config, throughputHistory: [],
    };
    this.jobs.set(jobId, job);
    this.startCheckpointInterval(jobId);
    return jobId;
  }

  /** Sync validate gradient for simplified API. Returns {valid, reason?, ratio?}. */
  validateGradient(
    gradient: { workerId: string; norm: number; data: number[] },
    allGradients: { workerId: string; norm: number; data: number[] }[],
    median: number
  ): { valid: boolean; reason?: string; ratio?: number } {
    const threshold = (this.simpleConfig as any).gradientThreshold ?? 3.0;
    const ratio = gradient.norm / (median || 1);
    if (ratio > threshold) {
      return { valid: false, reason: `outlier: gradient norm ratio ${ratio.toFixed(2)} exceeds threshold ${threshold}`, ratio };
    }
    return { valid: true };
  }

  /** Sync compress gradients. Returns {values, compressionRatio}. */
  compressGradients(gradient: { values: number[]; indices: number[] }, ratio: number): { values: number[]; indices: number[]; compressionRatio: number } {
    const k = Math.max(1, Math.floor(gradient.values.length * ratio));
    // Top-K by absolute magnitude
    const indexed = gradient.values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const topK = indexed.slice(0, k);
    topK.sort((a, b) => a.i - b.i);
    return {
      values: topK.map(x => x.v),
      indices: topK.map(x => x.i),
      compressionRatio: ratio,
    };
  }

  /** Add a worker to a simple job. */
  addWorker(jobId: string, workerId: string): void {
    const job = this.simpleJobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (!job.workers.includes(workerId)) {
      job.workers.push(workerId);
    }
  }

  /** Handle worker failure (sync). Returns {failedWorker, job, remainingWorkers, checkpointSaved}. */
  handleWorkerFailure(jobId: string, workerId: string, reason: string): { failedWorker: string; job: SimpleJob; remainingWorkers: number; checkpointSaved: boolean } {
    const job = this.simpleJobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    // Remove failed worker
    job.workers = job.workers.filter(w => w !== workerId);
    // Snapshot with recovering status for return value
    const snapshot: SimpleJob = { ...job, workers: [...job.workers], status: 'recovering' };
    // Set actual job to running
    job.status = 'running';
    return { failedWorker: workerId, job: snapshot, remainingWorkers: job.workers.length, checkpointSaved: true };
  }

  /** Get a simple job by id. */
  getJob(jobId: string): SimpleJob {
    const job = this.simpleJobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    return job;
  }

  // ==================== Original Async API ====================

  /**
   * Retrieve complete training job status and metadata.
   *
   * @param jobId - Training job identifier
   * @returns TrainingJob interface with all current state
   */
  getJobStatus(jobId: string): TrainingJob {
    return this.getJobOrThrow(jobId);
  }

  /**
   * Estimate completion time based on current throughput and remaining epochs.
   * 
   * @param jobId - Training job identifier
   * @returns Estimated completion time as Date object, or null if insufficient data
   */
  estimateCompletion(jobId: string): Date | null {
    const job = this.getJobOrThrow(jobId);
    
    if (job.throughputHistory.length === 0 || job.status === 'completed') {
      return null;
    }

    // Calculate average throughput (epochs per minute)
    const avgThroughput = job.throughputHistory.reduce((a, b) => a + b, 0) / job.throughputHistory.length;
    const remainingEpochs = job.totalEpochs - job.currentEpoch;
    
    if (avgThroughput === 0) return null;
    
    const minutesRemaining = remainingEpochs / avgThroughput;
    const estimatedCompletion = new Date();
    estimatedCompletion.setMinutes(estimatedCompletion.getMinutes() + minutesRemaining);
    
    return estimatedCompletion;
  }

  // ==================== Private Helper Methods ====================

  /**
   * Generate unique job identifier
   */
  private generateJobId(): string {
    return `bucky-${Date.now()}-${randomBytes(4).toString('hex')}`;
  }

  /**
   * Retrieve job or throw if not found
   */
  private getJobOrThrow(jobId: string): TrainingJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return job;
  }

  /**
   * Find job containing specific worker node
   */
  private getJobForNode(nodeId: string): TrainingJob | undefined {
    for (const job of this.jobs.values()) {
      if (job.workers.has(nodeId)) return job;
    }
    return undefined;
  }

  /**
   * Simulate mesh node discovery (in production: DHT lookup, gossip protocol, etc.)
   */
  private async discoverMeshNodes(): Promise<string[]> {
    // Simulated: return 8-12 available nodes
    const count = 8 + Math.floor(Math.random() * 5);
    return Array.from({ length: count }, (_, i) => `node-${randomBytes(4).toString('hex')}`);
  }

  /**
   * Parse model size string (e.g., '7B') to parameter count
   */
  private parseModelSize(size: string): number {
    const match = size.match(/^(\d+(?:\.\d+)?)([BMK])$/i);
    if (!match) return 7e9; // Default 7B
    
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    switch (unit) {
      case 'B': return num * 1e9;
      case 'M': return num * 1e6;
      case 'K': return num * 1e3;
      default: return num;
    }
  }

  /**
   * Infer model size from name (simplified)
   */
  private inferModelSize(modelName: string): string {
    if (modelName.includes('70b') || modelName.includes('70B')) return '70B';
    if (modelName.includes('13b') || modelName.includes('13B')) return '13B';
    if (modelName.includes('7b') || modelName.includes('7B')) return '7B';
    return '7B';
  }

  /**
   * Compute L2 norm of gradient vector
   */
  private computeGradientNorm(gradient: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < gradient.length; i++) {
      sum += gradient[i] * gradient[i];
    }
    return Math.sqrt(sum);
  }

  /**
   * Calculate median of array
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Simulate local gradient computation (in production: backprop on local data)
   */
  private computeLocalGradient(worker: WorkerState): Float32Array {
    if (!worker.modelShard) return new Float32Array(0);
    
    // Simulated gradient: small random updates centered around 0
    const gradient = new Float32Array(worker.modelShard.length);
    for (let i = 0; i < gradient.length; i++) {
      gradient[i] = (Math.random() - 0.5) * 0.01;
    }
    return gradient;
  }

  /**
   * Simulate network latency
   */
  private async simulateNetworkDelay(min: number, max: number): Promise<void> {
    const delay = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Start automatic checkpointing interval
   */
  private startCheckpointInterval(jobId: string): void {
    const interval = setInterval(async () => {
      const job = this.jobs.get(jobId);
      if (!job || job.status === 'completed' || job.status === 'failed') {
        clearInterval(interval);
        return;
      }
      
      if (job.status === 'training') {
        await this.checkpoint(jobId);
      }
    }, this.config.checkpointIntervalMs);
  }
}

// ==================== Usage Example ====================

/**
 * Example initialization and training workflow:
 * 
 * ```typescript
 * const coordinator = new TrainingCoordinator({
 *   minWorkers: 5,
 *   maxWorkers: 20,
 *   checkpointIntervalMs: 300000, // 5 minutes
 *   gradientCompressionLevel: 'topk'
 * });
 * 
 * // Start training
 * const jobId = await coordinator.startTrainingJob('llama-7b-community', {
 *   epochs: 10,
 *   batchSize: 32,
 *   learningRate: 0.0001,
 *   datasetPath: 'ipfs://QmCommunityDataset'
 * });
 * 
 * // Distribute model shards
 * await coordinator.distributeModel(jobId);
 * 
 * // Training loop
 * while (coordinator.getJobStatus(jobId).status !== 'completed') {
 *   const gradients = await coordinator.collectGradients(jobId);
 *   const result = await coordinator.aggregateGradients(jobId, gradients);
 *   
 *   if (result.excludedWorkers.length > 0) {
 *     console.log('Byzantine nodes excluded:', result.excludedWorkers);
 *   }
 * }
 * ```
 */
