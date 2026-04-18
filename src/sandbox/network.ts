/**
 * Network Setup Utilities
 * Network namespaces and tap device configuration
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function setupNetworkNamespace(nsName: string): Promise<void> {
  try {
    await execAsync(`ip netns add ${nsName}`);
    await execAsync(`ip netns exec ${nsName} ip link set lo up`);
  } catch (e) {
    throw new Error(`Failed to create network namespace: ${e}`);
  }
}

export async function setupTapDevice(nsName: string, tapName: string): Promise<void> {
  try {
    await execAsync(`ip netns exec ${nsName} ip tuntap add ${tapName} mode tap`);
    await execAsync(`ip netns exec ${nsName} ip link set ${tapName} up`);
  } catch (e) {
    throw new Error(`Failed to setup tap device: ${e}`);
  }
}

export async function cleanupNetworkNamespace(nsName: string): Promise<void> {
  try {
    await execAsync(`ip netns del ${nsName} 2>/dev/null || true`);
  } catch {}
}

export function generateMAC(): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `02:00:00:${hex(Math.floor(Math.random() * 256))}:${hex(Math.floor(Math.random() * 256))}:${hex(Math.floor(Math.random() * 256))}`;
}
