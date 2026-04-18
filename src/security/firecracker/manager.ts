/**
 * VM lifecycle management with security hardening
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { rmdir, writeFile, readFile } from 'fs/promises';
import { enforceSeccompProfile, validateKernelVersion } from './seccomp';
import { verifyRootfsImage, createReadOnlyOverlay } from './rootfs';
import { setupIptablesRules } from './network';
import { enforceResourceLimits, monitorResources } from './resources';
import { pinCPU, disableHyperthreading, enableCacheIsolation } from './isolation';
import { signSnapshot, verifySnapshot, rollbackToKnownGood } from './snapshot';
import { configureMinimalDevices, auditDeviceSurface } from './devices';
import { EgressPolicy, ResourceLimits, VMStats, VMMetadata } from './types';

const execFileAsync = promisify(execFile);

export class FirecrackerManager {
  private vms = new Map<string, VMMetadata>();
  private maxVMs: number;

  constructor(maxVMs: number = 100) {
    this.maxVMs = maxVMs;
  }

  async register(vmId: string, pid: number, rootfsPath: string): Promise<void> {
    if (this.vms.size >= this.maxVMs) throw new Error(`VM limit: ${this.maxVMs}`);

    const vm: VMMetadata = {
      id: vmId, pid, startTime: Date.now(), lastActivity: Date.now(),
      cgroupPath: `bucky/${vmId}`, netNsPath: `/proc/${pid}/ns/net`, rootfsPath
    };
    this.vms.set(vmId, vm);
    console.log(`[INFO] Registered VM ${vmId} (PID: ${pid})`);
  }

  async unregister(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) return;

    try {
      await execFileAsync('nsenter', ['-t', vm.pid.toString(), '-n', 'iptables', '-F']);
    } catch { /* ignore */ }

    try {
      await execFileAsync('umount', [`/var/lib/bucky/overlays/${vmId}`], { timeout: 5000 });
      await rmdir(`/var/lib/bucky/overlays/${vmId}`, { recursive: true });
    } catch { /* ignore */ }

    this.vms.delete(vmId);
    console.log(`[INFO] Unregistered VM ${vmId}`);
  }

  async harden(vmId: string, egress: EgressPolicy, limits: ResourceLimits): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);

    await validateKernelVersion();
    await verifyRootfsImage(vm.rootfsPath);
    await enforceSeccompProfile(vmId);
    await setupIptablesRules(vmId, vm.pid, egress);
    await enforceResourceLimits(vmId, vm.cgroupPath, limits);
    await configureMinimalDevices(vm);
    await pinCPU(vm, [0, 1]);
    await disableHyperthreading(vm);
    await enableCacheIsolation(vm);

    console.log(`[SECURE] Hardened VM ${vmId}`);
  }

  async monitor(vmId: string): Promise<VMStats> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    return monitorResources(vmId, vm);
  }

  async audit(vmId: string): Promise<{ devices: string[]; flags: string[] }> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    return auditDeviceSurface(vm);
  }

  async sign(vmId: string, key: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm?.snapshotPath) throw new Error(`No snapshot for ${vmId}`);
    await signSnapshot(vm.snapshotPath, key);
  }

  async rollback(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    await rollbackToKnownGood(vm);
  }

  get count(): number { return this.vms.size; }
}

export * from './types';
