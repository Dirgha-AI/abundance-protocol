import { EventEmitter } from 'events';

export interface VMConfig {
  cpuCount: number;
  memoryMB: number;
}

export class FirecrackerClient extends EventEmitter {
  async createVM(config: VMConfig): Promise<string> {
    const vmId = `vm-${Date.now()}`;
    console.log(`[Firecracker] Created VM ${vmId}`);
    this.emit('vm:created', { vmId, config });
    return vmId;
  }
  
  async startVM(vmId: string): Promise<void> {
    console.log(`[Firecracker] Started VM ${vmId}`);
    this.emit('vm:started', { vmId });
  }
  
  async stopVM(vmId: string): Promise<void> {
    console.log(`[Firecracker] Stopped VM ${vmId}`);
    this.emit('vm:stopped', { vmId });
  }
}

export default FirecrackerClient;
