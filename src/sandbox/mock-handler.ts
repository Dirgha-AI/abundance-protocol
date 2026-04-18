/**
 * Mock VM Handler
 * Development/testing mode when Firecracker unavailable
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as net from 'net';
import { promisify } from 'util';
import { exec } from 'child_process';
import { ExecutionResult } from './types.js';

const execAsync = promisify(exec);

export class MockVMHandler {
  private process?: ChildProcess;
  private socketPath: string;
  private metrics: {
    cpuMs: number;
    memoryPeakMB: number;
    startTime: number;
  };
  private readonly memoryLimitMB: number;

  constructor(
    private vmId: string,
    private config: { memory: number; vcpus: number; networkEnabled: boolean }
  ) {
    this.socketPath = `/tmp/mock-vm-${vmId}.sock`;
    this.metrics = { cpuMs: 0, memoryPeakMB: 0, startTime: Date.now() };
    this.memoryLimitMB = config.memory;
  }

  async start(): Promise<void> {
    const agentCode = this.buildAgentCode();
    const spawnArgs = ['-e', agentCode];

    this.process = spawn('node', spawnArgs, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await this.applyCgroupLimits();
    await this.waitForReady();
  }

  private buildAgentCode(): string {
    return `
      const net = require('net');
      const { exec } = require('child_process');
      const fs = require('fs');
      
      let cpuStart = process.cpuUsage();
      let memPeak = 0;
      
      setInterval(() => {
        const mem = process.memoryUsage();
        memPeak = Math.max(memPeak, mem.rss / 1024 / 1024);
        const cpu = process.cpuUsage(cpuStart);
        fs.writeFileSync('/tmp/mock-${this.vmId}-metrics.json', JSON.stringify({
          cpuMs: (cpu.user + cpu.system) / 1000,
          memoryPeakMB: memPeak
        }));
      }, 1000);

      const server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (data) => {
          buffer += data.toString();
          if (buffer.includes('\\n')) {
            const cmd = buffer.trim();
            buffer = '';
            const startTime = Date.now();
            const child = exec(cmd, { 
              timeout: 300000,
              maxBuffer: 10 * 1024 * 1024,
              env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' }
            }, (err, stdout, stderr) => {
              const duration = Date.now() - startTime;
              const result = JSON.stringify({
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: err ? (err.code || 1) : 0,
                cpuMs: duration,
                memoryPeakMB: memPeak
              });
              socket.write(result + '\\n');
              socket.end();
            });
          }
        });
      });

      server.listen('${this.socketPath}', () => {
        console.log('MOCK_VM_READY');
      });
    `;
  }

  private async applyCgroupLimits(): Promise<void> {
    if (process.platform === 'linux' && this.process) {
      try {
        const cgroupPath = `/sys/fs/cgroup/mock-${this.vmId}`;
        await execAsync(
          `mkdir -p ${cgroupPath} && echo ${this.process.pid} > ${cgroupPath}/cgroup.procs && ` +
          `echo ${this.memoryLimitMB * 1024 * 1024} > ${cgroupPath}/memory.max`
        ).catch(() => {});
      } catch {}
    }
  }

  private async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mock VM startup timeout')), 5000);
      
      this.process?.stdout?.on('data', (data) => {
        if (data.toString().includes('MOCK_VM_READY')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      
      this.process?.on('error', reject);
      this.process?.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Mock VM exited with code ${code}`));
      });
    });
  }

  async execute(command: string, timeoutMs: number = 30000): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(this.socketPath);
      let data = '';
      let timeout: NodeJS.Timeout;

      client.on('connect', () => client.write(command + '\n'));

      client.on('data', (chunk) => {
        data += chunk.toString();
        if (data.includes('\n')) {
          clearTimeout(timeout);
          client.end();
          try {
            const result = JSON.parse(data.trim());
            this.metrics.cpuMs += result.cpuMs;
            this.metrics.memoryPeakMB = Math.max(this.metrics.memoryPeakMB, result.memoryPeakMB);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        }
      });

      client.on('error', reject);
      timeout = setTimeout(() => {
        client.destroy();
        reject(new Error('Command timeout'));
      }, timeoutMs);
    });
  }

  getProcess(): ChildProcess | undefined { return this.process; }
  getSocketPath(): string { return this.socketPath; }

  getMetrics(): { cpuMs: number; memoryPeakMB: number; uptime: number } {
    return {
      cpuMs: this.metrics.cpuMs,
      memoryPeakMB: this.metrics.memoryPeakMB,
      uptime: Date.now() - this.metrics.startTime,
    };
  }

  async cleanup(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1000));
      if (!this.process.killed) this.process.kill('SIGKILL');
    }
    try {
      await fs.unlink(this.socketPath).catch(() => {});
      await execAsync(`rm -rf /sys/fs/cgroup/mock-${this.vmId}`).catch(() => {});
    } catch {}
  }
}
