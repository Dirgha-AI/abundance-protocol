/**
 * Hardware Jailer Tests
 * GPU passthrough and microVM orchestration
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HardwareJailer, GPUDevice, VMInstance } from '../../src/vm/jailer';

describe('HardwareJailer', () => {
  let jailer: HardwareJailer;

  beforeEach(() => {
    jailer = new HardwareJailer({ simulationMode: true });
  });

  afterEach(async () => {
    await jailer.cleanup();
  });

  it('should initialize in simulation mode', () => {
    const stats = jailer.getStats();
    expect(stats.simulationMode).toBe(true);
  });

  it('should detect GPU devices (simulated)', () => {
    const devices = jailer.detectIOMMU();
    // In simulation mode, may return empty or mock data
    expect(Array.isArray(devices)).toBe(true);
  });

  it('should get IOMMU groups', () => {
    const groups = jailer.getIOMMUGroups();
    expect(groups instanceof Map).toBe(true);
  });

  it('should bind devices to VFIO', async () => {
    const testAddr = '0000:01:00.0';
    
    await jailer.bindVFIO(testAddr);
    
    const bound = jailer.getBoundGPUs();
    expect(bound).toContain(testAddr);
  });

  it('should create VM with GPU', async () => {
    const gpu: GPUDevice = {
      pciAddress: '0000:01:00.0',
      vendorId: '10de',
      deviceId: '1e07',
      iommuGroup: 1,
      isolated: true,
      name: 'NVIDIA Test GPU',
    };

    const vmId = await jailer.createVM({
      cpuCount: 2,
      memoryMB: 4096,
      gpu,
      kernelPath: '/var/lib/bucky/vmlinux',
      rootfsPath: '/var/lib/bucky/rootfs.ext4',
    });

    expect(vmId).toBeTruthy();
    expect(vmId.startsWith('vm-')).toBe(true);

    const vm = jailer.getVM(vmId);
    expect(vm).toBeDefined();
    expect(vm!.status).toBe('running');
    expect(vm!.gpu).toEqual(gpu);
  });

  it('should create VM without GPU', async () => {
    const vmId = await jailer.createVM({
      cpuCount: 1,
      memoryMB: 1024,
      kernelPath: '/var/lib/bucky/vmlinux',
      rootfsPath: '/var/lib/bucky/rootfs.ext4',
    });

    const vm = jailer.getVM(vmId);
    expect(vm!.gpu).toBeUndefined();
  });

  it('should reject non-isolated GPU', async () => {
    const gpu: GPUDevice = {
      pciAddress: '0000:01:00.0',
      vendorId: '10de',
      deviceId: '1e07',
      iommuGroup: 1,
      isolated: false, // Not isolated
      name: 'NVIDIA Test GPU',
    };

    await expect(jailer.createVM({
      cpuCount: 2,
      memoryMB: 4096,
      gpu,
      kernelPath: '/vmlinux',
      rootfsPath: '/rootfs.ext4',
    })).rejects.toThrow('not isolated');
  });

  it('should stop VM and release GPU', async () => {
    const gpu: GPUDevice = {
      pciAddress: '0000:01:00.1',
      vendorId: '10de',
      deviceId: '1e07',
      iommuGroup: 2,
      isolated: true,
    };

    const vmId = await jailer.createVM({
      cpuCount: 2,
      memoryMB: 4096,
      gpu,
      kernelPath: '/vmlinux',
      rootfsPath: '/rootfs.ext4',
    });

    expect(jailer.getBoundGPUs()).toContain(gpu.pciAddress);

    await jailer.stopVM(vmId);

    const vm = jailer.getVM(vmId);
    expect(vm!.status).toBe('stopped');
    expect(jailer.getBoundGPUs()).not.toContain(gpu.pciAddress);
  });

  it('should verify GPU passthrough', async () => {
    const gpu: GPUDevice = {
      pciAddress: '0000:01:00.2',
      vendorId: '10de',
      deviceId: '1e07',
      iommuGroup: 3,
      isolated: true,
    };

    const vmId = await jailer.createVM({
      cpuCount: 2,
      memoryMB: 4096,
      gpu,
      kernelPath: '/vmlinux',
      rootfsPath: '/rootfs.ext4',
    });

    // In simulation mode, always returns true
    expect(jailer.verifyPassthrough(vmId)).toBe(true);
  });

  it('should list all VMs', async () => {
    await jailer.createVM({
      cpuCount: 1,
      memoryMB: 1024,
      kernelPath: '/vmlinux',
      rootfsPath: '/rootfs.ext4',
    });

    await jailer.createVM({
      cpuCount: 2,
      memoryMB: 2048,
      kernelPath: '/vmlinux',
      rootfsPath: '/rootfs.ext4',
    });

    const vms = jailer.getVMs();
    expect(vms.length).toBe(2);
  });

  it('should get statistics', async () => {
    await jailer.createVM({
      cpuCount: 1,
      memoryMB: 1024,
      kernelPath: '/vmlinux',
      rootfsPath: '/rootfs.ext4',
    });

    const stats = jailer.getStats();
    expect(stats.totalVMs).toBe(1);
    expect(stats.runningVMs).toBe(1);
    expect(stats.simulationMode).toBe(true);
  });

  it('should throw on unknown VM', async () => {
    await expect(jailer.stopVM('unknown-vm-id')).rejects.toThrow('not found');
  });

  it('should emit events', async () => {
    const events: string[] = [];
    
    jailer.on('vm:created', () => events.push('created'));
    jailer.on('vm:stopped', () => events.push('stopped'));

    const vmId = await jailer.createVM({
      cpuCount: 1,
      memoryMB: 1024,
      kernelPath: '/vmlinux',
      rootfsPath: '/rootfs.ext4',
    });

    expect(events).toContain('created');

    await jailer.stopVM(vmId);
    expect(events).toContain('stopped');
  });

  it('should cleanup all VMs', async () => {
    await jailer.createVM({ cpuCount: 1, memoryMB: 1024, kernelPath: '/vmlinux', rootfsPath: '/rootfs.ext4' });
    await jailer.createVM({ cpuCount: 1, memoryMB: 1024, kernelPath: '/vmlinux', rootfsPath: '/rootfs.ext4' });

    expect(jailer.getVMs().length).toBe(2);

    await jailer.cleanup();

    // All VMs should be stopped
    const running = jailer.getVMs().filter(v => v.status === 'running');
    expect(running.length).toBe(0);
  });
});
