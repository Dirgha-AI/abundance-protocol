/**
 * Snapshot signing and verification
 */

import { readFile, writeFile, access } from 'fs/promises';
import { sign, verify } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { VMMetadata } from './types';

const execFileAsync = promisify(execFile);

export async function signSnapshot(snapshotPath: string, key: string): Promise<void> {
  let privateKey: Buffer;
  if (await access(key).then(() => true).catch(() => false)) {
    privateKey = await readFile(key);
  } else {
    privateKey = Buffer.from(key, 'base64');
  }

  const data = await readFile(snapshotPath);
  const signature = sign(null, data, privateKey);
  await writeFile(`${snapshotPath}.sig`, signature);
  console.log(`[SECURE] Signed ${snapshotPath}`);
}

export async function verifySnapshot(snapshotPath: string, signature: string, publicKey: string): Promise<boolean> {
  let pubKeyBuf: Buffer;
  let sigBuf: Buffer;

  if (await access(publicKey).then(() => true).catch(() => false)) {
    pubKeyBuf = await readFile(publicKey);
  } else {
    pubKeyBuf = Buffer.from(publicKey, 'base64');
  }

  if (await access(signature).then(() => true).catch(() => false)) {
    sigBuf = await readFile(signature);
  } else {
    sigBuf = Buffer.from(signature, 'base64');
  }

  const data = await readFile(snapshotPath);
  const isValid = verify(null, data, pubKeyBuf, sigBuf);
  if (!isValid) throw new Error(`Snapshot signature verification failed for ${snapshotPath}`);
  console.log(`[SECURE] Verified ${snapshotPath}`);
  return true;
}

export async function rollbackToKnownGood(vm: VMMetadata): Promise<void> {
  if (!vm.snapshotPath) throw new Error(`No snapshot for ${vm.id}`);

  await verifySnapshot(vm.snapshotPath, `${vm.snapshotPath}.sig`, '/etc/bucky/snapshot.pub');
  await execFileAsync('kill', ['-STOP', vm.pid.toString()]);

  await execFileAsync('curl', [
    '-X', 'PUT',
    '--unix-socket', `/var/lib/bucky/vms/${vm.id}/firecracker.sock`,
    '-d', `{"snapshot_path": "${vm.snapshotPath}"}`,
    'http://localhost/snapshot/load'
  ]);

  await execFileAsync('kill', ['-CONT', vm.pid.toString()]);
  console.log(`[SECURE] Rolled back ${vm.id}`);
}
