/**
 * Sandbox VM Types
 * All type definitions for VM management
 */

import { ChildProcess } from 'child_process';

export interface VMRequirements {
  memory?: number;
  vcpus?: number;
  networkEnabled?: boolean;
  gpuPassthrough?: boolean;
  timeoutMs?: number;
}

export interface VMInstance {
  taskId: string;
  vmId: string;
  pid: number;
  socketPath: string;
  state: 'booting' | 'running' | 'stopped' | 'error';
  createdAt: Date;
  config: {
    memory: number;
    vcpus: number;
    networkEnabled: boolean;
  };
}

export interface VMStatus {
  state: string;
  uptime: number;
  cpuUsage: number;
  memoryUsage: number;
}

export interface VMMetrics {
  cpuSeconds: number;
  memoryMBHours: number;
  networkBytes: number;
  diskReadBytes: number;
  diskWriteBytes: number;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cpuMs: number;
  memoryPeakMB: number;
}

export interface VMInternal extends VMInstance {
  process: ChildProcess;
  metrics: VMMetrics;
  lastMetricsTime: number;
  networkNamespace?: string;
  tapDevice?: string;
  guestCid?: number;
  mockMode?: boolean;
  mockHandler?: import('./mock-handler.js').MockVMHandler;
  commandHistory: Array<{ cmd: string; startTime: number; endTime?: number }>;
}

export interface SandboxConfig {
  maxVMs: number;
  defaultMemoryMB: number;
  defaultVcpus: number;
  kernelPath: string;
  rootfsPath: string;
}
