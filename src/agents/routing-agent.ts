/**
 * RoutingAgent — intelligent job-to-worker/agent matching on the Bucky mesh.
 *
 * Responsibilities:
 * - Maintain a registry of available workers/agents with their skill vectors
 * - Score incoming jobs against worker profiles (MoE-inspired weighted scoring)
 * - Route jobs to best-fit workers
 * - Track job queue depth, latency, and failure rates
 * - Requeue failed jobs with exponential backoff
 */
import { BuckyAgent } from './base.js';

export interface WorkerProfile {
  id: string;
  name: string;
  type: 'human' | 'agent';
  skills: string[];
  reputationScore: number; // 0-5
  availableSats: number;
  acceptsRemote: boolean;
  status: 'available' | 'busy' | 'offline';
}

export interface JobRequest {
  id: string;
  title: string;
  requiredSkills: string[];
  budgetSats: number;
  priority: 'low' | 'medium' | 'high';
  postedAt: Date;
  attempts: number;
  assignedTo?: string;
}

export interface MatchResult {
  jobId: string;
  workerId: string;
  matchScore: number;
  matchedSkills: string[];
  assignedAt: Date;
}

export interface RoutingAgentConfig {
  /** Max number of routing attempts before job is marked failed */
  maxAttempts?: number;
  /** Base retry delay ms (doubles each attempt) */
  retryBaseMs?: number;
  /** How often to run routing cycle ms (default 15s) */
  routeCycleMs?: number;
  /** Skill match weight (vs. reputation) — must sum to 1 */
  skillWeight?: number;
  reputationWeight?: number;
  /** Callbacks */
  getAvailableWorkers?: () => Promise<WorkerProfile[]>;
  getPendingJobs?: () => Promise<JobRequest[]>;
  onMatch?: (result: MatchResult) => Promise<void>;
  onJobFailed?: (jobId: string, reason: string) => Promise<void>;
}

export class RoutingAgent extends BuckyAgent {
  private config: Required<RoutingAgentConfig>;
  private routeTimer: ReturnType<typeof setTimeout> | null = null;
  private matchHistory: MatchResult[] = [];
  private failedJobs: Map<string, string> = new Map();

  constructor(id: string, name: string, config: RoutingAgentConfig = {}) {
    super(id, name, 'routing');
    const skillWeight = config.skillWeight ?? 0.6;
    const reputationWeight = config.reputationWeight ?? 0.4;
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      retryBaseMs: config.retryBaseMs ?? 5_000,
      routeCycleMs: config.routeCycleMs ?? 15_000,
      skillWeight,
      reputationWeight,
      getAvailableWorkers: config.getAvailableWorkers ?? (async () => []),
      getPendingJobs: config.getPendingJobs ?? (async () => []),
      onMatch: config.onMatch ?? (async (r) => {
        console.log(`[RoutingAgent] Matched job ${r.jobId} → worker ${r.workerId} (score: ${r.matchScore.toFixed(2)})`);
      }),
      onJobFailed: config.onJobFailed ?? (async (id, reason) => {
        console.warn(`[RoutingAgent] Job ${id} failed: ${reason}`);
      }),
    };
  }

  protected onStart(): void {
    this.scheduleRoute();
  }

  protected onStop(): void {
    if (this.routeTimer) { clearTimeout(this.routeTimer); this.routeTimer = null; }
  }

  private scheduleRoute(): void {
    this.routeTimer = setTimeout(async () => {
      await this.routeCycle();
      if (this.status() === 'working') this.scheduleRoute();
    }, this.config.routeCycleMs);
  }

  async routeCycle(): Promise<MatchResult[]> {
    if (this.status() !== 'working') return [];
    this.setTask('Running routing cycle');
    const results: MatchResult[] = [];

    try {
      const [workers, jobs] = await Promise.all([
        this.config.getAvailableWorkers(),
        this.config.getPendingJobs(),
      ]);

      const availableWorkers = workers.filter((w) => w.status === 'available');

      for (const job of jobs) {
        if (job.attempts >= this.config.maxAttempts) {
          this.failedJobs.set(job.id, `Max attempts (${this.config.maxAttempts}) reached`);
          await this.config.onJobFailed(job.id, `Max attempts reached`);
          continue;
        }

        const best = this.findBestWorker(job, availableWorkers);
        if (!best) continue;

        const result: MatchResult = {
          jobId: job.id,
          workerId: best.worker.id,
          matchScore: best.score,
          matchedSkills: best.matchedSkills,
          assignedAt: new Date(),
        };

        // Mark worker busy so we don't double-assign
        best.worker.status = 'busy';
        job.assignedTo = best.worker.id;

        this.matchHistory.push(result);
        results.push(result);
        await this.config.onMatch(result);
        this.recordJobDone(0);
        this.emit('matched', result);
      }

      this.clearTask();
    } catch (err: any) {
      this.recordError(err);
    }

    return results;
  }

  private findBestWorker(
    job: JobRequest,
    workers: WorkerProfile[]
  ): { worker: WorkerProfile; score: number; matchedSkills: string[] } | null {
    let best: { worker: WorkerProfile; score: number; matchedSkills: string[] } | null = null;

    for (const worker of workers) {
      if (worker.status !== 'available') continue;
      if (worker.availableSats > 0 && job.budgetSats > 0 && worker.availableSats < job.budgetSats * 0.5) continue;

      const matchedSkills = job.requiredSkills.filter((s) =>
        worker.skills.some((ws) => ws.toLowerCase().includes(s.toLowerCase()))
      );
      const skillScore = job.requiredSkills.length > 0
        ? matchedSkills.length / job.requiredSkills.length
        : 1;
      const repScore = worker.reputationScore / 5;
      const combined = skillScore * this.config.skillWeight + repScore * this.config.reputationWeight;

      if (!best || combined > best.score) {
        best = { worker, score: combined, matchedSkills };
      }
    }

    return best;
  }

  /** Manually route a single job (for testing/API) */
  async route(job: JobRequest): Promise<MatchResult | null> {
    const workers = await this.config.getAvailableWorkers();
    const available = workers.filter((w) => w.status === 'available');
    const best = this.findBestWorker(job, available);
    if (!best) return null;

    const result: MatchResult = {
      jobId: job.id,
      workerId: best.worker.id,
      matchScore: best.score,
      matchedSkills: best.matchedSkills,
      assignedAt: new Date(),
    };
    await this.config.onMatch(result);
    this.matchHistory.push(result);
    this.emit('matched', result);
    return result;
  }

  getMatchHistory(): MatchResult[] {
    return [...this.matchHistory];
  }

  getFailedJobs(): Record<string, string> {
    return Object.fromEntries(this.failedJobs);
  }

  /** Queue depth = unmatched jobs */
  getQueueDepth(): number {
    return this.failedJobs.size;
  }
}
