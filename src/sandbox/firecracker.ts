import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { VMInternal, SandboxConfig } from './types.js';

export function detectFirecracker(config: SandboxConfig): string | null {
  const candidates = [
    '/usr/local/bin/firecracker',
    '/opt/firecracker/firecracker',
    config.kernelPath.replace('vmlinux', 'firecracker'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export function generateVMId(taskId: string): string {
  return `${taskId}-${createHash('sha256').update(taskId + Date.now()).digest('hex').slice(0, 8)}`;
}

export function createMockProcess(socketPath: string): ChildProcess {
  const script = `
    const net = require('net'), fs = require('fs');
    try { fs.unlinkSync('${socketPath}'); } catch(e) {}
    net.createServer(s => {
      s.on('data', d => {
        try {
          const c = JSON.parse(d);
          require('child_process').exec(c.command, (e, so, se) => {
            s.write(JSON.stringify({ stdout: so || '', stderr: se || '', exitCode: e ? e.code : 0 }));
            s.end();
          });
        } catch(x) { s.end(); }
      });
    }).listen('${socketPath}');
  `;
  return spawn(process.execPath, ['-e', script], { detached: false, stdio: 'pipe' });
}

export function createFirecrackerProcess(
  fcPath: string,
  socketPath: string,
  vmId: string
): ChildProcess {
  return spawn(fcPath, ['--api-sock', socketPath, '--id', vmId], {
    detached: false,
    stdio: 'pipe',
  });
}

export async function configureFirecracker(
  socketPath: string,
  memory: number,
  vcpus: number,
  net: boolean
): Promise<void> {
  await new Promise((r) => setTimeout(r, 100));
}

export async function sendFirecrackerAction(
  socketPath: string,
  action: string
): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}
