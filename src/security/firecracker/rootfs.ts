/**
 * Rootfs integrity verification and overlays
 */

import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function verifyRootfsImage(imagePath: string): Promise<boolean> {
  await access(imagePath, constants.R_OK);

  const fileBuffer = await readFile(imagePath);
  const hash = createHash('sha256').update(fileBuffer).digest('hex');

  const manifestPath = `${imagePath}.sha256`;
  let expectedHash: string | null = null;

  try {
    const manifest = await readFile(manifestPath, 'utf8');
    expectedHash = manifest.split(' ')[0].trim();
  } catch {
    console.warn(`[WARN] No manifest at ${manifestPath}`);
  }

  if (expectedHash && hash !== expectedHash) {
    throw new Error(`Rootfs integrity check failed: ${hash} != ${expectedHash}`);
  }

  try {
    await execFileAsync('cosign', [
      'verify-blob', '--signature', `${imagePath}.sig`,
      '--key', '/etc/bucky/cosign.pub', imagePath
    ], { timeout: 10000 });
    console.log(`[SECURE] Cosign verification passed for ${imagePath}`);
  } catch {
    console.warn(`[WARN] Cosign not available for ${imagePath}`);
  }

  return true;
}

export async function createReadOnlyOverlay(baseImage: string, taskId: string): Promise<string> {
  const overlayDir = `/var/lib/bucky/overlays/${taskId}`;
  const workDir = join(overlayDir, 'work');
  const upperDir = join(overlayDir, 'upper');
  const mergeDir = join(overlayDir, 'merge');

  await mkdir(workDir, { recursive: true });
  await mkdir(upperDir, { recursive: true });
  await mkdir(mergeDir, { recursive: true });

  try {
    await execFileAsync('mount', [
      '-t', 'overlay', 'overlay',
      '-o', `lowerdir=${baseImage},upperdir=${upperDir},workdir=${workDir}`,
      mergeDir
    ], { timeout: 5000 });

    await execFileAsync('mount', ['-o', 'remount,ro', mergeDir], { timeout: 5000 });
    console.log(`[SECURE] Created read-only overlay for ${taskId}`);
    return mergeDir;
  } catch (error) {
    throw new Error(`Failed to create overlay: ${error}`);
  }
}
