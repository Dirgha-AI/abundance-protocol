/**
 * BuckyAgent — base class for all Bucky mesh agents.
 *
 * Provides: lifecycle (start/stop/pause/resume), status reporting,
 * heartbeat, cost tracking, EventEmitter interface.
 */
import { EventEmitter } from 'events';

export type AgentStatus = 'idle' | 'working' | 'paused' | 'error' | 'stopped';

export interface AgentMetrics {
  jobsCompleted: number;
  costSats: number;
  uptimeMs: number;
  lastActivity: Date | null;
  errorCount: number;
}

export abstract class BuckyAgent extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly type: string;

  protected _status: AgentStatus = 'idle';
  protected _task: string | null = null;
  protected _startedAt: Date | null = null;
  protected _metrics: AgentMetrics = {
    jobsCompleted: 0,
    costSats: 0,
    uptimeMs: 0,
    lastActivity: null,
    errorCount: 0,
  };

  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(id: string, name: string, type: string) {
    super();
    this.id = id;
    this.name = name;
    this.type = type;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    if (this._status === 'working') return;
    this._status = 'working';
    this._startedAt = new Date();
    this._heartbeatInterval = setInterval(() => this._heartbeat(), 30_000);
    this.emit('started', { id: this.id, name: this.name, type: this.type });
    console.log(`[${this.type}] ${this.name} started`);
    this.onStart();
  }

  stop(): void {
    if (this._status === 'stopped') return;
    this._status = 'stopped';
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    this.emit('stopped', { id: this.id });
    console.log(`[${this.type}] ${this.name} stopped`);
    this.onStop();
  }

  pause(): void {
    if (this._status !== 'working') return;
    this._status = 'paused';
    this.emit('paused', { id: this.id });
  }

  resume(): void {
    if (this._status !== 'paused') return;
    this._status = 'working';
    this.emit('resumed', { id: this.id });
  }

  // ─── Status / Metrics ─────────────────────────────────────────────────────

  status(): AgentStatus {
    return this._status;
  }

  currentTask(): string | null {
    return this._task;
  }

  metrics(): AgentMetrics {
    if (this._startedAt && this._status === 'working') {
      this._metrics.uptimeMs = Date.now() - this._startedAt.getTime();
    }
    return { ...this._metrics };
  }

  report(): object {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this._status,
      task: this._task,
      metrics: this.metrics(),
    };
  }

  // ─── Protected helpers ────────────────────────────────────────────────────

  protected setTask(task: string): void {
    this._task = task;
    this._metrics.lastActivity = new Date();
    this.emit('task', { id: this.id, task });
  }

  protected clearTask(): void {
    this._task = null;
  }

  protected recordJobDone(costSats = 0): void {
    this._metrics.jobsCompleted++;
    this._metrics.costSats += costSats;
    this._metrics.lastActivity = new Date();
    this.emit('job_completed', { id: this.id, costSats, total: this._metrics.jobsCompleted });
  }

  protected recordError(err: Error): void {
    this._metrics.errorCount++;
    this._status = 'error';
    this.emit('error', { id: this.id, error: err.message });
    console.error(`[${this.type}] ${this.name} error:`, err.message);
  }

  private _heartbeat(): void {
    this.emit('heartbeat', this.report());
  }

  // ─── Abstract hooks ───────────────────────────────────────────────────────

  protected abstract onStart(): void;
  protected abstract onStop(): void;
}
