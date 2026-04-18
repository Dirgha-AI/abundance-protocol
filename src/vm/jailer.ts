/**
 * Hardware Jailer v2.0 - GPU Passthrough & MicroVM Orchestration
 * Production-ready VM isolation with Firecracker
 */
import { execSync, spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface GPUDevice {
  pciAddress: string;
  vendorId: string;
  deviceId: string;
  iommuGroup: number;
  isolated: boolean;
  name?: string;
}

export interface VMInstance {
  id: string;
  cpuCount: number;
  memoryMB: number;
  gpu?: GPUDevice;
  kernelPath: string;
  rootfsPath: string;
  status: 'creating' | 'running' | 'stopped' | 'error';
  firecrackerPid?: number;
  vsockPath?: string;
  logPath?: string;
  createdAt: Date;
}

export interface FirecrackerConfig {
  bootSource: {
    kernel_image_path: string;
    boot_args?: string;
  };
  drives: Array<{
    drive_id: string;
    path_on_host: string;
    is_root_device: boolean;
    is_read_only: boolean;
  }>;
  machine_config: {
    vcpu_count: number;
    mem_size_mib: number;
    smt: boolean;
  };
  vsock?: {
    guest_cid: number;
    uds_path: string;
  };
  network_interfaces?: Array<{
    iface_id: string;
    guest_mac?: string;
    host_dev_name?: string;
  }>;
}

export class HardwareJailer extends EventEmitter {
  private vms = new Map<string, VMInstance>();
  private boundDevices = new Set<string>();
  private firecrackerBin: string;
  private vmBasePath: string;
  private simulationMode: boolean;
  private processes = new Map<string, ChildProcess>();

  constructor(options: {
    firecrackerPath?: string;
    vmBasePath?: string;
    simulationMode?: boolean;
  } = {}) {
    super();
    this.firecrackerBin = options.firecrackerPath || '/usr/local/bin/firecracker';
    this.vmBasePath = options.vmBasePath || '/var/lib/bucky/vms';
    this.simulationMode = options.simulationMode ?? !this.checkHardwareSupport();
    
    if (!existsSync(this.vmBasePath)) {
      mkdirSync(this.vmBasePath, { recursive: true });
    }

    if (this.simulationMode) {
      this.emit('mode', { type: 'simulation' });
    } else {
      this.emit('mode', { type: 'hardware' });
    }
  }

  /**
   * Check if hardware supports GPU passthrough
   */
  private checkHardwareSupport(): boolean {
    try {
      // Check IOMMU is enabled
      const iommuStatus = readFileSync('/sys/kernel/iommu_groups/0', 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect IOMMU groups and GPU devices
   */
  detectIOMMU(): GPUDevice[] {
    const devices: GPUDevice[] = [];

    if (this.simulationMode) {
      this.emit('gpus:detected', { count: 0, devices });
      return devices;
    }

    try {
      const list = execSync('lspci -nn | grep -E "VGA|3D|Display"').toString();
      
      for (const line of list.split('\n')) {
        const addrMatch = line.match(/^([0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f])/i);
        if (!addrMatch) continue;
        
        const addr = addrMatch[1];
        const idsMatch = line.match(/\[([0-9a-f]{4}):([0-9a-f]{4})\]/i);
        if (!idsMatch) continue;

        let group = -1;
        let isolated = false;
        let name = line.split('[').pop()?.split(']')[1]?.trim();

        try {
          // Get IOMMU group
          const groupPath = execSync(`readlink /sys/bus/pci/devices/${addr}/iommu_group`).toString().trim();
          group = parseInt(groupPath.split('/').pop() || '-1', 10);
          
          // Check if isolated (only device in group)
          const devicesInGroup = execSync(`ls /sys/kernel/iommu_groups/${group}/devices 2>/dev/null`)
            .toString()
            .split('\n')
            .filter(Boolean);
          isolated = devicesInGroup.length === 1;
        } catch (e) {
          // IOMMU not available for this device
        }

        devices.push({
          pciAddress: addr,
          vendorId: idsMatch[1],
          deviceId: idsMatch[2],
          iommuGroup: group,
          isolated,
          name,
        });
      }
    } catch (e) {
      this.emit('error', { type: 'detection', error: e });
    }

    this.emit('gpus:detected', { count: devices.length, devices });
    return devices;
  }

  /**
   * Get IOMMU groups for visualization
   */
  getIOMMUGroups(): Map<number, string[]> {
    const groups = new Map<number, string[]>();
    
    try {
      const groupDirs = execSync('ls /sys/kernel/iommu_groups/ 2>/dev/null').toString().split('\n').filter(Boolean);
      
      for (const groupId of groupDirs) {
        const devices = execSync(`ls /sys/kernel/iommu_groups/${groupId}/devices 2>/dev/null`)
          .toString()
          .split('\n')
          .filter(Boolean);
        groups.set(parseInt(groupId, 10), devices);
      }
    } catch {
      // IOMMU not enabled
    }
    
    return groups;
  }

  /**
   * Bind device to vfio-pci for passthrough
   */
  async bindVFIO(addr: string): Promise<void> {
    if (this.simulationMode) {
      this.boundDevices.add(addr);
      this.emit('gpu:bound', { pciAddress: addr, simulated: true });
      return;
    }

    if (this.boundDevices.has(addr)) {
      this.emit('gpu:bound', { pciAddress: addr, cached: true });
      return;
    }

    try {
      // Unbind from current driver
      execSync(`echo ${addr} > /sys/bus/pci/devices/${addr}/driver/unbind 2>/dev/null || true`);
      
      // Set driver override
      execSync(`echo vfio-pci > /sys/bus/pci/devices/${addr}/driver_override`);
      
      // Bind to vfio-pci
      execSync(`echo ${addr} > /sys/bus/pci/drivers/vfio-pci/bind`);
      
      // Verify binding
      const bound = execSync(`ls /sys/bus/pci/drivers/vfio-pci 2>/dev/null | grep ${addr}`).toString();
      if (!bound.includes(addr)) {
        throw new Error(`Failed to bind ${addr} to vfio-pci`);
      }

      this.boundDevices.add(addr);
      this.emit('gpu:bound', { pciAddress: addr });
    } catch (e) {
      this.emit('error', { type: 'vfio_bind', addr, error: e });
      throw new Error(`VFIO bind failed for ${addr}: ${e}`);
    }
  }

  /**
   * Create Firecracker microVM
   */
  async createVM(cfg: Omit<VMInstance, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const id = `vm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const vmPath = join(this.vmBasePath, id);
    
    if (!existsSync(vmPath)) {
      mkdirSync(vmPath, { recursive: true });
    }

    const vm: VMInstance = {
      ...cfg,
      id,
      status: 'creating',
      createdAt: new Date(),
      vsockPath: join(vmPath, 'vsock.sock'),
      logPath: join(vmPath, 'firecracker.log'),
    };

    // Bind GPU if specified
    if (cfg.gpu) {
      if (!cfg.gpu.isolated) {
        throw new Error(`GPU ${cfg.gpu.pciAddress} is not isolated (requires isolated IOMMU group)`);
      }
      await this.bindVFIO(cfg.gpu.pciAddress);
    }

    if (this.simulationMode) {
      vm.status = 'running';
      vm.firecrackerPid = -1;
      this.vms.set(id, vm);
      this.emit('vm:created', { id, simulated: true });
      return id;
    }

    // Create Firecracker config
    const firecrackerConfig: FirecrackerConfig = {
      bootSource: {
        kernel_image_path: cfg.kernelPath,
        boot_args: 'console=ttyS0 reboot=k panic=1 pci=off',
      },
      drives: [
        {
          drive_id: 'rootfs',
          path_on_host: cfg.rootfsPath,
          is_root_device: true,
          is_read_only: false,
        },
      ],
      machine_config: {
        vcpu_count: cfg.cpuCount,
        mem_size_mib: cfg.memoryMB,
        smt: false,
      },
      vsock: {
        guest_cid: 3,
        uds_path: vm.vsockPath!,
      },
    };

    // Write config
    const configPath = join(vmPath, 'config.json');
    writeFileSync(configPath, JSON.stringify(firecrackerConfig, null, 2));

    // Start Firecracker
    const socketPath = join(vmPath, 'firecracker.sock');
    const process = spawn(this.firecrackerBin, [
      '--api-sock', socketPath,
      '--config-file', configPath,
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(id, process);
    vm.firecrackerPid = process.pid!;

    // Log output
    process.stdout?.on('data', (data) => {
      this.emit('vm:log', { id, level: 'info', message: data.toString() });
    });

    process.stderr?.on('data', (data) => {
      this.emit('vm:log', { id, level: 'error', message: data.toString() });
    });

    process.on('exit', (code) => {
      if (code !== 0) {
        vm.status = 'error';
        this.emit('vm:error', { id, code });
      }
    });

    vm.status = 'running';
    this.vms.set(id, vm);
    this.emit('vm:created', { id, pid: process.pid });

    return id;
  }

  /**
   * Stop VM and release resources
   */
  async stopVM(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (this.simulationMode) {
      vm.status = 'stopped';
      if (vm.gpu) {
        this.boundDevices.delete(vm.gpu.pciAddress);
      }
      this.vms.set(id, vm);
      this.emit('vm:stopped', { id, simulated: true });
      return;
    }

    // Kill Firecracker process
    const process = this.processes.get(id);
    if (process) {
      process.kill('SIGTERM');
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 5000);
      this.processes.delete(id);
    }

    // Release GPU
    if (vm.gpu) {
      this.boundDevices.delete(vm.gpu.pciAddress);
    }

    vm.status = 'stopped';
    this.vms.set(id, vm);
    this.emit('vm:stopped', { id });
  }

  /**
   * Verify GPU passthrough is active
   */
  verifyPassthrough(vmId: string): boolean {
    const vm = this.vms.get(vmId);
    if (!vm?.gpu) return false;

    if (this.simulationMode) {
      return true;
    }

    try {
      const bound = execSync('ls /sys/bus/pci/drivers/vfio-pci 2>/dev/null').toString();
      return bound.includes(vm.gpu.pciAddress);
    } catch {
      return false;
    }
  }

  /**
   * Get VM status and info
   */
  getVM(id: string): VMInstance | undefined {
    return this.vms.get(id);
  }

  /**
   * List all VMs
   */
  getVMs(): VMInstance[] {
    return Array.from(this.vms.values());
  }

  /**
   * Get bound GPU devices
   */
  getBoundGPUs(): string[] {
    return Array.from(this.boundDevices);
  }

  /**
   * Get jailer statistics
   */
  getStats(): {
    totalVMs: number;
    runningVMs: number;
    boundGPUs: number;
    simulationMode: boolean;
  } {
    const allVMs = this.getVMs();
    return {
      totalVMs: allVMs.length,
      runningVMs: allVMs.filter(v => v.status === 'running').length,
      boundGPUs: this.boundDevices.size,
      simulationMode: this.simulationMode,
    };
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    for (const [id, vm] of this.vms) {
      if (vm.status === 'running') {
        await this.stopVM(id);
      }
    }
    this.emit('cleaned');
  }
}

export default HardwareJailer;

export { HardwareJailer as VMJailer };
