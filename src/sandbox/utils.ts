/**
 * Sandbox Utilities
 * Helper functions for VM management
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { execSync } from 'child_process';

export async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.access(socketPath);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Timeout waiting for Firecracker API socket');
}

export function detectFirecracker(): string | null {
  try {
    const paths = [
      '/usr/local/bin/firecracker',
      '/usr/bin/firecracker',
      './firecracker',
      path.join(process.cwd(), 'firecracker'),
    ];

    for (const p of paths) {
      try {
        fsSync.accessSync(p, fsSync.constants.X_OK);
        return p;
      } catch {}
    }

    const result = execSync('which firecracker', { encoding: 'utf8' });
    return result.toString().trim();
  } catch {
    return null;
  }
}

export function generateVMId(taskId: string): string {
  const hash = createHash('md5').update(taskId + Date.now()).digest('hex').substring(0, 8);
  return `bucky-${taskId}-${hash}`;
}

export async function cleanupSocket(socketPath: string): Promise<void> {
  try {
    await fs.unlink(socketPath);
  } catch {}
}
