/**
 * Sandbox Manager
 * Orchestrates Firecracker MicroVMs for Project Bucky mesh
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { VMInstance, VMStatus, VMMetrics, ExecutionResult, VMInternal, SandboxConfig } from './types.js';
import { VMLauncher, LaunchResult } from './vm-launcher.js';
import { VMExecutor } from './vm-executor.js';
import { VMMonitor } from './vm-monitor.js';
import { detectFirecracker, generateVMId } from './utils.js';

export class SandboxManager {
  private vms = new Map<string, VMInternal>();
  private launcher: VMLauncher;
  private executor: VMExecutor;
  private monitor: VMMonitor;
  private readonly baseDir: string;
  private readonly useMock: boolean;

  constructor(private config: SandboxConfig) {
    this.baseDir = `/tmp/bucky-sandbox-${Date.now()}`;
    const firecrackerBin = detectFirecracker();
    this.useMock = !firecrackerBin;

    if (this.useMock) {
      console.warn('[SandboxManager] Firecracker not found. Running in MOCK MODE.');
    }

    this.launcher = new VMLauncher(config, this.useMock, firecrackerBin, this.baseDir);
    this.executor = new VMExecutor(this.useMock);
    this.monitor = new VMMonitor();

    fs.mkdir(this.baseDir, { recursive: true }).catch(console.error);
  }

  async createVM(taskId: string, requirements: {
    memory?: number;
    vcpus?: number;
    networkEnabled?: boolean;
    timeoutMs?: number;
  }): Promise<VMInstance> {
    if (this.vms.size >= this.config.maxVMs) throw new Error(`Maximum VM limit (${this.config.maxVMs})`);
    if (this.vms.has(taskId)) throw new Error(`VM for ${taskId} already exists`);

    const vmId = generateVMId(taskId);
    const { paths, config } = this.prepareConfig(vmId, requirements);
    const launch = await this.launcher.launch(vmId, config.memory, config.vcpus, config.networkEnabled, paths.socketPath, paths.vsockPath, paths.logPath, paths.metricsPath);

    const vm = this.buildVM(taskId, vmId, launch, paths.socketPath, config);
    this.vms.set(taskId, vm);

    this.monitor.setupTimeout(this.vms, taskId, config.timeoutMs, this.destroyVM.bind(this));
    this.monitor.monitorProcess(this.vms, taskId, vm.process);

    return this.monitor.toInstance(vm);
  }

  private prepareConfig(vmId: string, requirements: { memory?: number; vcpus?: number; networkEnabled?: boolean; timeoutMs?: number }) {
    return {
      paths: {
        socketPath: path.join(this.baseDir, `${vmId}.sock`),
        vsockPath: path.join(this.baseDir, `${vmId}-vsock.sock`),
        logPath: path.join(this.baseDir, `${vmId}.log`),
        metricsPath: path.join(this.baseDir, `${vmId}-metrics.json`),
      },
      config: {
        memory: requirements.memory || this.config.defaultMemoryMB,
        vcpus: requirements.vcpus || this.config.defaultVcpus,
        networkEnabled: requirements.networkEnabled || false,
        timeoutMs: requirements.timeoutMs || 300000,
      }
    };
  }

  private buildVM(taskId: string, vmId: string, launch: LaunchResult, socketPath: string, cfg: { memory: number; vcpus: number; networkEnabled: boolean }): VMInternal {
    return {
      taskId, vmId,
      pid: launch.process.pid!,
      socketPath: this.useMock && launch.mockHandler ? launch.mockHandler.getSocketPath() : socketPath,
      state: 'running',
      createdAt: new Date(),
      config: { memory: cfg.memory, vcpus: cfg.vcpus, networkEnabled: cfg.networkEnabled },
      process: launch.process,
      metrics: { cpuSeconds: 0, memoryMBHours: 0, networkBytes: 0, diskReadBytes: 0, diskWriteBytes: 0 },
      lastMetricsTime: Date.now(),
      networkNamespace: launch.networkNamespace,
      guestCid: launch.guestCid,
      mockHandler: launch.mockHandler,
      commandHistory: [],
    };
  }

  async executeInVM(taskId: string, command: string, timeoutMs: number = 30000): Promise<ExecutionResult> {
    const vm = this.vms.get(taskId);
    if (!vm) throw new Error(`VM for ${taskId} not found`);
    if (vm.state !== 'running') throw new Error(`VM not running (${vm.state})`);
    return this.executor.execute(vm, command, timeoutMs);
  }

  async getVMStatus(taskId: string): Promise<VMStatus> {
    const vm = this.vms.get(taskId);
    if (!vm) throw new Error(`VM for ${taskId} not found`);
    return this.monitor.getStatus(vm, this.useMock);
  }

  async listVMs(): Promise<VMInstance[]> {
    return Array.from(this.vms.values()).map(v => this.monitor.toInstance(v));
  }

  getMetrics(taskId: string): VMMetrics {
    const vm = this.vms.get(taskId);
    if (!vm) throw new Error(`VM for ${taskId} not found`);
    return this.monitor.getMetrics(vm);
  }

  async destroyVM(taskId: string): Promise<void> {
    const vm = this.vms.get(taskId);
    if (!vm) throw new Error(`VM for ${taskId} not found`);
    vm.state = 'stopped';
    if (vm.mockHandler) await vm.mockHandler.cleanup();
    this.vms.delete(taskId);
  }
}
