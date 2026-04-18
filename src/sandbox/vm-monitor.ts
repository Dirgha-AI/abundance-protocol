/**
 * VM Monitor
 * Handles VM lifecycle monitoring and cleanup
 */

import { ChildProcess } from 'child_process';
import { VMInternal, VMMetrics, VMStatus, VMInstance } from './types.js';
import { MockVMHandler } from './mock-handler.js';

export class VMMonitor {
  setupTimeout(
    vms: Map<string, VMInternal>,
    taskId: string,
    timeoutMs: number,
    destroyFn: (id: string) => Promise<void>
  ): void {
    setTimeout(() => {
      if (vms.has(taskId)) {
        console.log(`[SandboxManager] Timeout for VM ${taskId}, destroying...`);
        destroyFn(taskId).catch(console.error);
      }
    }, timeoutMs);
  }

  monitorProcess(vms: Map<string, VMInternal>, taskId: string, process: ChildProcess): void {
    process.on('exit', (code) => {
      const vm = vms.get(taskId);
      if (vm) vm.state = code === 0 ? 'stopped' : 'error';
    });
  }

  getStatus(vm: VMInternal, useMock: boolean): VMStatus {
    const uptime = Date.now() - vm.createdAt.getTime();
    let cpuUsage = 0;
    let memoryUsage = 0;

    if (useMock && vm.mockHandler) {
      const metrics = vm.mockHandler.getMetrics();
      cpuUsage = metrics.cpuMs / uptime;
      memoryUsage = metrics.memoryPeakMB;
    }

    return {
      state: vm.state,
      uptime,
      cpuUsage: Math.min(cpuUsage, 100),
      memoryUsage,
    };
  }

  getMetrics(vm: VMInternal): VMMetrics {
    const hours = (Date.now() - vm.createdAt.getTime()) / 3600000;
    return { ...vm.metrics, memoryMBHours: vm.config.memory * hours };
  }

  toInstance(vm: VMInternal): VMInstance {
    return {
      taskId: vm.taskId,
      vmId: vm.vmId,
      pid: vm.pid,
      socketPath: vm.socketPath,
      state: vm.state,
      createdAt: vm.createdAt,
      config: vm.config,
    };
  }
}
