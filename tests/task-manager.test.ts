import { describe, it, expect, beforeEach } from 'vitest';
import { TaskManager } from '../src/tasks/manager.js';

const capabilities = {
  cpu: { cores: 8, model: 'AMD Ryzen 7' },
  gpu: { model: 'RTX 3080', vram: 10240, cudaCores: 8704 },
  memory: 16384,
  storage: 500,
  bandwidth: 100
};

describe('TaskManager', () => {
  let manager: TaskManager;

  beforeEach(() => {
    manager = new TaskManager(capabilities);
  });

  it('posts a task and returns task with id and posted status', () => {
    const task = manager.postTask({
      cpuSeconds: 60,
      gpuSeconds: 30,
      requirements: {
        minCpuCores: 4,
        minMemoryMB: 2048
      }
    });
    
    expect(task).toHaveProperty('id');
    expect(typeof task.id).toBe('string');
    expect(task.id.length).toBeGreaterThan(0);
    expect(task.status).toBe('posted');
  });

  it('calculates cost correctly: 120s CPU + 60s GPU = 420 sats', () => {
    const cost = manager.calculateCost({
      cpuSeconds: 120,
      gpuSeconds: 60
    });
    
    expect(cost).toBe(420);
  });

  it('calculates 70/20/10 split: 1000 sats → 700 worker, 200 upstream, 100 treasury', () => {
    const split = manager.calculateSplit(1000);
    
    expect(split.worker).toBe(700);
    expect(split.upstream).toBe(200);
    expect(split.treasury).toBe(100);
    expect(split.worker + split.upstream + split.treasury).toBe(1000);
  });

  it('bids on task when capabilities meet requirements', () => {
    const task = manager.postTask({
      requirements: {
        minCpuCores: 4,
        minGpuVram: 8192,
        minMemoryMB: 8192
      }
    });
    
    const bid = manager.bidOnTask(task.id);
    expect(bid.accepted).toBe(true);
  });

  it('rejects bid when GPU insufficient', () => {
    const task = manager.postTask({
      requirements: {
        minGpuVram: 20000 // Exceeds RTX 3080's 10240 MB
      }
    });
    
    const bid = manager.bidOnTask(task.id);
    expect(bid.accepted).toBe(false);
    expect(bid.reason).toMatch(/gpu|vram|insufficient/i);
  });

  it('completes task lifecycle: post → assign → start → complete → verify', () => {
    // Post
    const task = manager.postTask({
      cpuSeconds: 60,
      gpuSeconds: 30
    });
    expect(task.status).toBe('posted');
    
    // Assign
    const assigned = manager.assignTask(task.id, 'worker-node-1');
    expect(assigned.status).toBe('assigned');
    
    // Start
    const started = manager.startTask(task.id);
    expect(started.status).toBe('running');
    
    // Complete
    const completed = manager.completeTask(task.id, { resultHash: '0xabc123' });
    expect(completed.status).toBe('completed');
    
    // Verify
    const verified = manager.verifyTask(task.id);
    expect(verified.status).toBe('verified');
  });

  it('returns active tasks list', () => {
    const task1 = manager.postTask({ cpuSeconds: 10 });
    const task2 = manager.postTask({ cpuSeconds: 20 });
    
    // Complete one task
    manager.assignTask(task1.id, 'worker-1');
    manager.startTask(task1.id);
    manager.completeTask(task1.id);
    
    // Keep one active
    manager.assignTask(task2.id, 'worker-2');
    manager.startTask(task2.id);
    
    const active = manager.getActiveTasks();
    expect(active.some(t => t.id === task2.id)).toBe(true);
    expect(active.every(t => t.status !== 'completed' && t.status !== 'verified')).toBe(true);
  });

  it('returns empty history initially', () => {
    const history = manager.getHistory();
    expect(history).toEqual([]);
    expect(history).toHaveLength(0);
  });
});
