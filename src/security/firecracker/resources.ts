/**
 * Resource limits and monitoring
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ResourceLimits, VMStats, VMMetadata } from './types';

const execFileAsync = promisify(execFile);

export async function enforceResourceLimits(vmId: string, cgroupPath: string, limits: ResourceLimits): Promise<void> {
  const fullPath = `/sys/fs/cgroup/${cgroupPath}`;
  await mkdir(fullPath, { recursive: true });

  const cpuQuota = Math.floor(limits.maxCpuPercent * 1000);
  await writeFile(join(fullPath, 'cpu.max'), `${cpuQuota} 100000`);

  const memoryBytes = limits.maxMemoryMB * 1024 * 1024;
  await writeFile(join(fullPath, 'memory.max'), memoryBytes.toString());
  await writeFile(join(fullPath, 'memory.oom.group'), limits.oomKillEnabled ? '1' : '0');

  if (limits.maxDiskIOps > 0) {
    await writeFile(join(fullPath, 'io.max'), `8:0 rbps=${limits.maxDiskIOps} wbps=${limits.maxDiskIOps}`);
  }
}

export async function monitorResources(vmId: string, vm: VMMetadata): Promise<VMStats> {
  const memCurrent = await readFile(`/sys/fs/cgroup/${vm.cgroupPath}/memory.current`, 'utf8');
  const memoryMB = parseInt(memCurrent.trim(), 10) / (1024 * 1024);

  const cpuStat = await readFile(`/sys/fs/cgroup/${vm.cgroupPath}/cpu.stat`, 'utf8');
  const usageMatch = cpuStat.match(/usage_usec\s+(\d+)/);
  const cpuPercent = usageMatch ? parseInt(usageMatch[1], 10) / 10000 : 0;

  const ioStat = await readFile(`/sys/fs/cgroup/${vm.cgroupPath}/io.stat`, 'utf8');
  const ioMatch = ioStat.match(/rbytes=(\d+)/);
  const diskIO = ioMatch ? parseInt(ioMatch[1], 10) : 0;

  let networkBytes = 0;
  try {
    const { stdout } = await execFileAsync('nsenter', ['-t', vm.pid.toString(), '-n', 'cat', '/proc/net/dev']);
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('eth0')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 1) networkBytes = parseInt(parts[1], 10);
      }
    }
  } catch { /* optional */ }

  vm.lastActivity = Date.now();
  return { cpuPercent, memoryMB, diskIO, networkBytes };
}
