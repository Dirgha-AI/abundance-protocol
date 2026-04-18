/**
 * VM Launcher
 * Handles both Mock and Firecracker VM launching
 */

import { ChildProcess } from 'child_process';
import { MockVMHandler } from './mock-handler.js';
import { FirecrackerAPI } from './firecracker-client.js';
import { setupNetworkNamespace, setupTapDevice, generateMAC } from './network.js';
import { waitForSocket } from './utils.js';
import { SandboxConfig } from './types.js';

export interface LaunchResult {
  process: ChildProcess;
  mockHandler?: MockVMHandler;
  networkNamespace?: string;
  guestCid?: number;
}

export class VMLauncher {
  private vmCounter = 0;

  constructor(
    private config: SandboxConfig,
    private useMock: boolean,
    private firecrackerBin: string | null,
    private baseDir: string
  ) {}

  async launch(
    vmId: string,
    memory: number,
    vcpus: number,
    networkEnabled: boolean,
    socketPath: string,
    vsockPath: string,
    logPath: string,
    metricsPath: string
  ): Promise<LaunchResult> {
    if (this.useMock) {
      const mockHandler = new MockVMHandler(vmId, { memory, vcpus, networkEnabled });
      await mockHandler.start();
      return { process: mockHandler.getProcess()!, mockHandler };
    }

    return this.launchFirecracker(
      vmId, memory, vcpus, networkEnabled, socketPath, vsockPath, logPath, metricsPath
    );
  }

  private async launchFirecracker(
    vmId: string,
    memory: number,
    vcpus: number,
    networkEnabled: boolean,
    socketPath: string,
    vsockPath: string,
    logPath: string,
    metricsPath: string
  ): Promise<LaunchResult> {
    let networkNamespace: string | undefined;
    const guestCid = 10000 + (++this.vmCounter);

    if (networkEnabled) {
      networkNamespace = `bucky-ns-${vmId}`;
      await setupNetworkNamespace(networkNamespace);
    }

    const { spawn } = await import('child_process');
    const args = [
      '--api-sock', socketPath,
      '--id', vmId,
      '--seccomp-level', '2',
      '--log-path', logPath,
      '--level', 'Warn',
    ];

    const process = networkNamespace
      ? spawn('ip', ['netns', 'exec', networkNamespace, this.firecrackerBin!, ...args], { stdio: 'pipe' })
      : spawn(this.firecrackerBin!, args, { stdio: 'pipe' });

    await waitForSocket(socketPath, 10000);
    await this.configureVM(socketPath, vsockPath, metricsPath, memory, vcpus, networkEnabled, networkNamespace);

    return { process, networkNamespace, guestCid };
  }

  private async configureVM(
    socketPath: string,
    vsockPath: string,
    metricsPath: string,
    memory: number,
    vcpus: number,
    networkEnabled: boolean,
    networkNamespace?: string
  ): Promise<void> {
    const api = new FirecrackerAPI(socketPath);
    const { basename } = await import('path');

    await api.put('/machine-config', {
      vcpu_count: vcpus,
      mem_size_mib: memory,
      track_dirty_pages: true,
      cpu_template: 'T2',
    });

    await api.put('/boot-source', {
      kernel_image_path: this.config.kernelPath,
      boot_args: 'console=ttyS0 reboot=k panic=1 pci=off nomodules random.trust_cpu=on',
    });

    await api.put('/drives/rootfs', {
      drive_id: 'rootfs',
      path_on_host: this.config.rootfsPath,
      is_root_device: true,
      is_read_only: true,
    });

    if (networkEnabled && networkNamespace) {
      const tapName = `tap-${basename(socketPath).substring(0, 8)}`;
      await setupTapDevice(networkNamespace, tapName);
      await api.put('/network-interfaces/eth0', {
        iface_id: 'eth0',
        guest_mac: generateMAC(),
        host_dev_name: tapName,
      });
    }

    await api.put('/vsock', { vsock_id: 'vsock0', guest_cid: 10000, uds_path: vsockPath });
    await api.put('/metrics', { metrics_path: metricsPath });
    await api.put('/actions', { action_type: 'InstanceStart' });
  }
}
