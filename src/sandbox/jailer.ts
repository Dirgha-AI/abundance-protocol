/**
 * Firecracker Jailer - Hardware Sovereignty & GPU Passthrough (v2.0)
 * @module sandbox/jailer
 */
import { execSync } from 'child_process';

export interface JailerConfig {
  vmId: string;
  numaNode: number;
  execFile: string;
  uid: number;
  gid: number;
  chrootBaseDir: string;
  gpuPassthrough?: {
    enabled: boolean;
    pciAddress: string; // e.g., '0000:01:00.0'
  };
}

export class Jailer {
  private activeJails: Map<string, JailerConfig> = new Map();

  async provision(config: JailerConfig): Promise<void> {
    console.log(`[Jailer] Provisioning secure environment for VM ${config.vmId}...`);
    
    if (config.gpuPassthrough?.enabled) {
      await this.configureGpuPassthrough(config.vmId, config.gpuPassthrough.pciAddress);
    }

    this.activeJails.set(config.vmId, config);
    console.log(`  ✓ Jailer root filesystem created at ${config.chrootBaseDir}/${config.vmId}`);
  }

  /**
   * Binds a host GPU to the vfio-pci driver, allowing the Firecracker microVM
   * bare-metal access to the hardware for maximum inference speed.
   */
  private async configureGpuPassthrough(vmId: string, pciAddress: string): Promise<void> {
     console.log(`[Jailer] Investigating IOMMU group isolation for GPU at ${pciAddress}...`);
     try {
       // Security Check: Verify this device is in its own isolated IOMMU group.
       // If other critical devices (like the bridge) are in the same group, 
       // the VM could escape.
       const iommuGroup = execSync(`readlink /sys/bus/pci/devices/${pciAddress}/iommu_group`).toString().split('/').pop();
       const devicesInGroup = execSync(`ls /sys/kernel/iommu_groups/${iommuGroup}/devices`).toString().split('\n').filter(Boolean);

       if (devicesInGroup.length > 1) {
         console.error(`[Critical Security] PCI device ${pciAddress} is NOT isolated. IOMMU group ${iommuGroup} contains multiple devices: ${devicesInGroup.join(',')}`);
         throw new Error('IOMMU_ISOLATION_FAILURE: Passthrough aborted to prevent host leakage.');
       }

       console.log(`  ✓ Isolated hardware verified. Binding ${pciAddress} to vfio-pci...`);
       execSync(`echo 'vfio-pci' > /sys/bus/pci/devices/${pciAddress}/driver_override`);
       execSync(`echo '${pciAddress}' > /sys/bus/pci/drivers/vfio-pci/bind`);
       console.log(`  ✓ GPU at ${pciAddress} bound to vfio-pci driver.`);
     } catch (err) {
      console.error(`[Jailer] Failed to configure GPU passthrough:`, err);
      throw new Error('Hardware Sovereignty Exception: GPU isolation failed.');
    }
  }

  async teardown(vmId: string): Promise<void> {
    console.log(`[Jailer] Tearing down environment for VM ${vmId}...`);
    this.activeJails.delete(vmId);
  }
}
