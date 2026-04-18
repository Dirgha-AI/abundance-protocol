import { randomUUID } from 'crypto';
import { globalBus } from '../shared/event-bus.js';
import type { MeshTask, TaskResult, NodeCapabilities, TaskType, TaskRequirements, ConsensusResult, TaskMetrics } from '../types/index.js';

export class TaskManager {
  private nodeId: string;
  private capabilities: NodeCapabilities;
  private activeTasks = new Map<string, MeshTask>();
  private completedTasks = new Map<string, TaskResult>();
  private taskWorkers = new Map<string, string>();
  private completedTaskObjects = new Map<string, MeshTask>();

  constructor(nodeIdOrCapabilities: string | NodeCapabilities, capabilities?: NodeCapabilities) {
    if (typeof nodeIdOrCapabilities === 'string') {
      this.nodeId = nodeIdOrCapabilities;
      this.capabilities = capabilities || { cpu: { cores: 4 }, memory: 8192 } as any;
    } else {
      this.nodeId = `node-${Date.now()}`;
      this.capabilities = nodeIdOrCapabilities;
    }
  }

  /** Original API: full args */
  postTask(description: string, type: TaskType, budget: number, requirements: TaskRequirements): MeshTask;
  /** Simplified API: object arg */
  postTask(opts: { cpuSeconds?: number; gpuSeconds?: number; requirements?: any; owner?: string; budget?: number }): MeshTask;
  postTask(descOrOpts: any, type?: TaskType, budget?: number, requirements?: TaskRequirements): MeshTask {
    if (typeof descOrOpts === 'string') {
      const task: MeshTask = { taskId: randomUUID(), posterId: this.nodeId, type: type!, description: descOrOpts, requirements: requirements!, budget: budget!, status: 'posted', createdAt: new Date() };
      this.activeTasks.set(task.taskId, task);
      try { globalBus.publish({ type: 'task.created', source: 'bucky', payload: { taskId: task.taskId, type, budget } }); } catch {}
      return task;
    } else {
      const opts = descOrOpts;
      // If called with {owner} it's the comprehensive API (status: 'open')
      // If called with {cpuSeconds/gpuSeconds} it's the task-manager API (status: 'posted')
      const isComprehensive = opts.owner !== undefined;
      const task: any = {
        taskId: randomUUID(),
        id: undefined as any,
        posterId: opts.owner || this.nodeId,
        type: 'compute_cpu' as TaskType,
        description: '',
        requirements: opts.requirements || {},
        budget: opts.budget || 0,
        status: isComprehensive ? 'open' : 'posted',
        createdAt: new Date(),
        cpuSeconds: opts.cpuSeconds || 0,
        gpuSeconds: opts.gpuSeconds || 0,
        payment: isComprehensive ? { worker: 0, platform: 0, treasury: 0 } : undefined,
      };
      task.id = task.taskId;
      this.activeTasks.set(task.taskId, task);
      return task;
    }
  }

  calculateCost(opts: { cpuSeconds?: number; gpuSeconds?: number; cpu?: number; duration?: number; gpu?: number }): number {
    if (opts.cpuSeconds !== undefined || opts.gpuSeconds !== undefined) {
      return (opts.cpuSeconds || 0) * 1 + (opts.gpuSeconds || 0) * 5;
    }
    // Legacy: { cpu, duration, gpu }
    return (opts.cpu || 0) * (opts.duration || 0) * 1 + (opts.gpu || 0) * (opts.duration || 0) * 5;
  }

  calculateSplit(total: number): { worker: number; upstream: number; treasury: number } {
    return { worker: Math.floor(total * 0.7), upstream: Math.floor(total * 0.2), treasury: total - Math.floor(total * 0.7) - Math.floor(total * 0.2) };
  }

  calculatePaymentSplit(total: number): { worker: number; platform: number; treasury: number } {
    return { worker: Math.floor(total * 0.7), platform: Math.floor(total * 0.2), treasury: total - Math.floor(total * 0.7) - Math.floor(total * 0.2) };
  }

  canHandleTask(task: MeshTask): boolean {
    const req: any = task.requirements;
    if (!req) return true;
    const caps: any = this.capabilities;
    if (req.minCpu && caps.cpu?.cores < req.minCpu) return false;
    if (req.minCpuCores && caps.cpu?.cores < req.minCpuCores) return false;
    if (req.minMemory && caps.memory < req.minMemory) return false;
    if (req.minMemoryMB && caps.memory < req.minMemoryMB) return false;
    if (req.minGpu && !caps.gpu) return false;
    if (req.minGpuVram && (!caps.gpu || caps.gpu.vram < req.minGpuVram)) return false;
    return true;
  }

  bidOnTask(taskId: string, workerCaps?: any): { accepted: boolean; reason?: string } {
    const task = this.activeTasks.get(taskId);
    if (!task) return { accepted: false, reason: 'Task not found' };
    const caps: any = workerCaps || this.capabilities;
    const req: any = task.requirements;
    if (req) {
      if (req.minCpuCores && caps.cpu?.cores < req.minCpuCores) return { accepted: false, reason: 'Insufficient CPU cores' };
      if (req.minMemoryMB && caps.memory < req.minMemoryMB) return { accepted: false, reason: 'Insufficient memory' };
      if (req.minGpuVram && (!caps.gpu || caps.gpu.vram < req.minGpuVram)) return { accepted: false, reason: 'Insufficient GPU VRAM' };
      if (req.gpu === true && !caps.gpu) return { accepted: false, reason: 'GPU required but not available' };
      if (req.gpuMemory && (!caps.gpu || caps.gpu.vram < req.gpuMemory)) return { accepted: false, reason: 'Insufficient GPU memory' };
    }
    return { accepted: true };
  }

  acceptBid(taskId: string, workerId: string): void {
    const task = this.activeTasks.get(taskId);
    if (task) { task.status = 'assigned'; this.taskWorkers.set(taskId, workerId); }
  }

  assignTask(taskId: string, workerId: string): MeshTask {
    const task = this.activeTasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'assigned';
    (task as any).assignedTo = workerId;
    this.taskWorkers.set(taskId, workerId);
    return task;
  }

  startTask(taskId: string): MeshTask {
    const task = this.activeTasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'running';
    (task as any).startedAt = new Date();
    return task;
  }

  completeTask(taskId: string, outputOrResult?: string | { resultHash?: string } | null, metrics?: TaskMetrics): any {
    const task = this.activeTasks.get(taskId) || this.completedTaskObjects.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'completed';
    if (typeof outputOrResult === 'string') {
      (task as any).resultHash = outputOrResult;
      if (metrics) {
        const result: TaskResult = { taskId, workerId: this.nodeId, output: outputOrResult, metrics, completedAt: new Date() };
        this.completedTaskObjects.set(taskId, task);
        this.completedTasks.set(taskId, result);
        this.activeTasks.delete(taskId);
        try { globalBus.publish({ type: 'task.completed', source: 'bucky', payload: { taskId, workerId: this.nodeId } }); } catch {}
        return task;
      }
    } else if (outputOrResult && typeof outputOrResult === 'object') {
      if ('resultHash' in outputOrResult) (task as any).resultHash = outputOrResult.resultHash;
    }
    this.completedTaskObjects.set(taskId, task);
    this.activeTasks.delete(taskId);
    try { globalBus.publish({ type: 'task.completed', source: 'bucky', payload: { taskId, workerId: this.nodeId } }); } catch {}
    return task;
  }

  verifyTask(taskId: string, isValid?: boolean): MeshTask {
    const task = this.completedTaskObjects.get(taskId) || this.activeTasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'verified';
    (task as any).verifiedAt = new Date();
    return task;
  }

  markVerified(taskId: string, consensusResult: ConsensusResult): void {
    try { globalBus.publish({ type: 'task.verified', source: 'bucky', payload: { taskId, verified: consensusResult.verified } }); } catch {}
  }

  getActiveTasks(): MeshTask[] { return Array.from(this.activeTasks.values()); }

  getHistory(): MeshTask[] { return Array.from(this.completedTaskObjects.values()); }

  createTask(data: Partial<MeshTask>): string {
    const taskId = randomUUID();
    const task: MeshTask = { taskId, posterId: this.nodeId, type: data.type ?? 'compute_cpu', description: data.description ?? '', requirements: data.requirements ?? {}, budget: data.budget ?? 0, status: 'posted', createdAt: new Date() };
    this.activeTasks.set(taskId, task);
    return taskId;
  }

  getTaskById(taskId: string): MeshTask | undefined {
    return this.activeTasks.get(taskId) ?? this.completedTaskObjects.get(taskId);
  }
}
