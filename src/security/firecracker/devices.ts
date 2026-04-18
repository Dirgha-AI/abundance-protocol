/**
 * Minimal device surface configuration
 */

import { writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { VMMetadata } from './types';

const execFileAsync = promisify(execFile);

export async function configureMinimalDevices(vm: VMMetadata): Promise<void> {
  const config = {
    boot_source: {
      kernel_image_path: '/var/lib/bucky/vmlinux-minimal',
      boot_args: 'console=ttyS0 noapic reboot=k panic=1 pci=off nomodules'
    },
    drives: [{ drive_id: 'rootfs', path_on_host: vm.rootfsPath, is_root_device: true, is_read_only: true }],
    network_interfaces: [{ iface_id: 'eth0', guest_mac: 'AA:FC:00:00:00:01', host_dev_name: `tap-${vm.id}` }],
    machine_config: { vcpu_count: 2, mem_size_mib: 512, smt: false, track_dirty_pages: false },
    vsock: null, balloon: null, logger: null, metrics: null, mmds_config: null
  };

  const configPath = `/var/lib/bucky/vms/${vm.id}/config.json`;
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await execFileAsync('chmod', ['000', '/dev/bus/usb']);
  await execFileAsync('chmod', ['000', '/dev/ttyS*']);
  console.log(`[SECURE] Configured minimal device surface for ${vm.id}`);
}

export async function auditDeviceSurface(vm: VMMetadata): Promise<{ devices: string[]; flags: string[] }> {
  const devices: string[] = [];
  const flags: string[] = [];

  try {
    const { stdout } = await execFileAsync('nsenter', ['-t', vm.pid.toString(), '-m', 'ls', '/sys/bus/pci/devices']);
    if (stdout.trim()) {
      devices.push(...stdout.trim().split('\n'));
      flags.push('WARNING: PCI devices exposed');
    }
  } catch { /* good - no PCI */ }

  try {
    await execFileAsync('nsenter', ['-t', vm.pid.toString(), '-m', 'ls', '/sys/bus/usb/devices']);
    flags.push('CRITICAL: USB bus exposed');
  } catch { /* good - no USB */ }

  const allowed = ['virtio0', 'virtio1', 'vda', 'vdb', 'eth0', 'lo'];
  const unexpected = devices.filter(d => !allowed.some(a => d.includes(a)));
  if (unexpected.length > 0) {
    flags.push(`CRITICAL: Unexpected devices: ${unexpected.join(', ')}`);
  }

  return { devices, flags };
}
