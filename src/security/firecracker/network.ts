/**
 * Network isolation and egress policies
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { EgressPolicy } from './types';

const execFileAsync = promisify(execFile);

export async function setupIptablesRules(vmId: string, pid: number, policy: EgressPolicy): Promise<void> {
  const commands: string[] = [
    'iptables -P OUTPUT DROP',
    'iptables -P INPUT DROP',
    'iptables -P FORWARD DROP',
    'iptables -A OUTPUT -o lo -j ACCEPT',
    'iptables -A INPUT -i lo -j ACCEPT',
    'iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
  ];

  for (const port of policy.allowedPorts) {
    commands.push(`iptables -A OUTPUT -p tcp --dport ${port} -j ACCEPT`);
    commands.push(`iptables -A OUTPUT -p udp --dport ${port} -j ACCEPT`);
  }

  for (const host of policy.allowedHosts) {
    try {
      const { stdout } = await execFileAsync('dig', ['+short', host], { timeout: 5000 });
      const ip = stdout.trim();
      if (ip) commands.push(`iptables -A OUTPUT -d ${ip} -j ACCEPT`);
    } catch {
      console.warn(`[WARN] Could not resolve ${host}`);
    }
  }

  if (policy.blockInternalMesh) {
    commands.push('iptables -A OUTPUT -d 10.0.0.0/8 -j DROP');
    commands.push('iptables -A OUTPUT -d 172.16.0.0/12 -j DROP');
    commands.push('iptables -A OUTPUT -d 192.168.0.0/16 -j DROP');
    commands.push('iptables -A OUTPUT -d 169.254.0.0/16 -j DROP');
  }

  if (policy.maxBandwidthMbps > 0) {
    commands.push(`iptables -A OUTPUT -m limit --limit ${policy.maxBandwidthMbps}mbit/s -j ACCEPT`);
  }

  for (const cmd of commands) {
    const args = ['-t', pid.toString(), '-n', ...cmd.split(' ')];
    await execFileAsync('nsenter', args, { timeout: 5000 });
  }
}
