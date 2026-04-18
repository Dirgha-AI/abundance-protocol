/**
 * VM Executor
 * Handles command execution in VMs
 */

import * as net from 'net';
import { ExecutionResult, VMInternal } from './types.js';
import { MockVMHandler } from './mock-handler.js';

export class VMExecutor {
  constructor(private useMock: boolean) {}

  async execute(vm: VMInternal, command: string, timeoutMs: number): Promise<ExecutionResult> {
    const startTime = Date.now();
    vm.commandHistory.push({ cmd: command, startTime });

    const result = this.useMock && vm.mockHandler
      ? await vm.mockHandler.execute(command, timeoutMs)
      : await this.executeViaVsock(vm, command, timeoutMs);

    const duration = (Date.now() - startTime) / 1000;
    vm.metrics.cpuSeconds += result.cpuMs / 1000;
    vm.metrics.memoryMBHours += (result.memoryPeakMB * duration) / 3600;

    return result;
  }

  private executeViaVsock(vm: VMInternal, command: string, timeoutMs: number): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(vm.socketPath.replace('.sock', '-vsock.sock'));
      let data = Buffer.alloc(0);
      let timeout: NodeJS.Timeout;

      client.on('connect', () => client.write(JSON.stringify({ cmd: command, timeout: timeoutMs })));

      client.on('data', (chunk) => { data = Buffer.concat([data, chunk]); });

      client.on('end', () => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          resolve({
            stdout: response.stdout || '',
            stderr: response.stderr || '',
            exitCode: response.exit_code || 0,
            cpuMs: response.cpu_ms || 0,
            memoryPeakMB: response.memory_peak_mb || 0,
          });
        } catch {
          reject(new Error('Invalid response from guest agent'));
        }
      });

      client.on('error', (err) => { clearTimeout(timeout); reject(err); });

      timeout = setTimeout(() => {
        client.destroy();
        reject(new Error('Vsock communication timeout'));
      }, timeoutMs + 5000);
    });
  }
}
