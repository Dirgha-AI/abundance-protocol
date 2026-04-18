/**
 * CPU pinning and cache isolation
 */

import { writeFile, readFile, access, mkdir } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { VMMetadata } from './types';

const execFileAsync = promisify(execFile);

export async function pinCPU(vm: VMMetadata, cores: number[]): Promise<void> {
  const cpuset = cores.join(',');
  await execFileAsync('taskset', ['-pc', cpuset, vm.pid.toString()]);

  const cgroupPath = `/sys/fs/cgroup/${vm.cgroupPath}`;
  await writeFile(join(cgroupPath, 'cpuset.cpus'), cpuset);
  vm.pinnedCores = cores;
  console.log(`[SECURE] Pinned ${vm.id} to cores ${cpuset}`);
}

export async function disableHyperthreading(vm: VMMetadata): Promise<void> {
  const physicalCores: number[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      const siblings = await readFile(`/sys/devices/system/cpu/cpu${i}/topology/thread_siblings_list`, 'utf8');
      const firstCore = parseInt(siblings.split(',')[0], 10);
      if (!physicalCores.includes(firstCore)) physicalCores.push(firstCore);
    } catch { break; }
  }
  if (physicalCores.length > 0) {
    await pinCPU(vm, physicalCores.slice(0, 2));
  }
  console.log(`[SECURE] Disabled hyperthreading for ${vm.id}`);
}

export async function enableCacheIsolation(vm: VMMetadata): Promise<void> {
  const resctrlPath = '/sys/fs/resctrl';
  try { await access(resctrlPath); } catch {
    console.warn('[WARN] CAT not available (requires Intel RDT)');
    return;
  }

  const cosName = `bucky-${vm.id}`;
  const cosPath = join(resctrlPath, cosName);

  try {
    await mkdir(cosPath, { recursive: true });
    await writeFile(join(cosPath, 'tasks'), vm.pid.toString());
    await writeFile(join(cosPath, 'schemata'), 'L3:0=1');
    console.log(`[SECURE] Enabled CAT cache isolation for ${vm.id}`);
  } catch (error) {
    console.warn(`[WARN] Failed to enable CAT: ${error}`);
  }
}
