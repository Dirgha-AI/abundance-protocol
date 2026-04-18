/**
 * hardware.ts - Hardware capability detection (78 lines)
 * Detects CPU, RAM, GPU via nvidia-smi and returns tier classification
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';

export interface HardwareCapabilities {
  cpuCores: number;
  ramGB: number;
  gpuVRAM?: number;
  avx2: boolean;
  tier: 'cpu' | 'mid-gpu' | 'high-gpu';
}

function detectCPU(): { cores: number; avx2: boolean } {
  const cores = os.cpus().length;
  let avx2 = false;
  try {
    if (process.platform === 'linux') {
      const cpuinfo = execSync('cat /proc/cpuinfo', { encoding: 'utf8' });
      avx2 = cpuinfo.includes('avx2');
    } else if (process.platform === 'darwin') {
      const sysctl = execSync('sysctl -a', { encoding: 'utf8' });
      avx2 = sysctl.includes('AVX2') || sysctl.includes('avx2');
    }
  } catch { /* ignore */ }
  return { cores, avx2 };
}

function detectRAM(): number {
  return Math.round(os.totalmem() / 1024 / 1024 / 1024);
}

function detectGPU(): { vram: number } | null {
  if (!existsSync('/usr/bin/nvidia-smi') && !existsSync('/usr/local/bin/nvidia-smi')) {
    return null;
  }
  try {
    const output = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', {
      encoding: 'utf8',
      timeout: 5000,
    });
    const vramMB = parseInt(output.trim().split('\n')[0], 10);
    return { vram: Math.round(vramMB / 1024) };
  } catch { return null; }
}

export function detectHardware(): HardwareCapabilities {
  const cpu = detectCPU();
  const ram = detectRAM();
  const gpu = detectGPU();

  let tier: HardwareCapabilities['tier'] = 'cpu';
  if (gpu) {
    tier = gpu.vram >= 24 ? 'high-gpu' : 'mid-gpu';
  }

  return {
    cpuCores: cpu.cores,
    ramGB: ram,
    gpuVRAM: gpu?.vram,
    avx2: cpu.avx2,
    tier,
  };
}
