/**
 * Seccomp enforcement for VM isolation
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { WHITELISTED_SYSCALLS, BLOCKED_SYSCALLS } from './syscalls';

const execFileAsync = promisify(execFile);

export interface SeccompFilter {
  defaultAction: string;
  archMap: Array<{ architecture: string; subArchitectures: string[] }>;
  syscalls: Array<{ names: string[]; action: string; args: any[] }>;
}

export async function enforceSeccompProfile(vmId: string): Promise<void> {
  const filter: SeccompFilter = {
    defaultAction: 'SCMP_ACT_ERRNO',
    archMap: [
      { architecture: 'SCMP_ARCH_X86_64', subArchitectures: ['SCMP_ARCH_X86'] },
      { architecture: 'SCMP_ARCH_AARCH64', subArchitectures: ['SCMP_ARCH_ARM'] }
    ],
    syscalls: [
      { names: WHITELISTED_SYSCALLS.slice(0, 60), action: 'SCMP_ACT_ALLOW', args: [] },
      { names: BLOCKED_SYSCALLS, action: 'SCMP_ACT_KILL_PROCESS', args: [] }
    ]
  };

  const filterPath = `/tmp/seccomp-${vmId}.json`;
  await writeFile(filterPath, JSON.stringify(filter, null, 2));

  try {
    await execFileAsync('prctl', ['--seccomp', filterPath], { timeout: 5000 });
    console.log(`[SECURE] Applied seccomp filter to ${vmId}`);
  } finally {
    await unlink(filterPath).catch(() => {});
  }
}

export async function validateKernelVersion(): Promise<boolean> {
  const { release } = await import('os');
  const kernelRelease = release();
  const match = kernelRelease.match(/^(\d+)\.(\d+)/);
  if (!match) throw new Error('Unable to parse kernel version');

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const compliant = major > 5 || (major === 5 && minor >= 10);

  if (!compliant) {
    throw new Error(`Kernel ${kernelRelease} vulnerable. Require >= 5.10`);
  }
  return true;
}
