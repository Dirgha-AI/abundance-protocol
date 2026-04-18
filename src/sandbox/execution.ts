import net from 'net';
import { VMInternal, ExecutionResult } from './types.js';

export async function executeInVM(
  vms: Map<string, VMInternal>,
  taskId: string,
  command: string,
  timeoutMs?: number
): Promise<ExecutionResult> {
  const vm = vms.get(taskId);
  if (!vm || vm.state !== 'running') {
    throw new Error('VM not available or not running');
  }

  const start = Date.now();

  return new Promise((resolve, reject) => {
    const client = net.createConnection(vm.socketPath, () => {
      client.write(vm.mockMode ? JSON.stringify({ command }) + '\n' : command);
    });

    let data = '';
    client.on('data', (c) => (data += c.toString()));
    client.on('end', () => {
      const ms = Date.now() - start;
      vm.metrics.cpuSeconds += ms / 1000;
      vm.metrics.memoryMBHours += (vm.config.memory * ms) / 3600000;

      const res = vm.mockMode
        ? JSON.parse(data)
        : { stdout: data, stderr: '', exitCode: 0, memoryPeakMB: vm.config.memory };

      resolve({
        stdout: res.stdout ?? data,
        stderr: res.stderr ?? '',
        exitCode: res.exitCode ?? 0,
        cpuMs: ms,
        memoryPeakMB: res.memoryPeakMB ?? vm.config.memory,
      });
    });
    client.on('error', reject);

    if (timeoutMs) {
      client.setTimeout(timeoutMs, () => {
        client.destroy();
        reject(new Error('Execution timeout'));
      });
    }
  });
}
