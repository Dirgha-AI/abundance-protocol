/**
 * Firecracker Security Types
 */

export interface EgressPolicy {
  allowedPorts: number[];
  allowedHosts: string[];
  blockInternalMesh: boolean;
  maxBandwidthMbps: number;
}

export interface ResourceLimits {
  maxCpuPercent: number;
  maxMemoryMB: number;
  maxDiskIOps: number;
  maxTimeoutSeconds: number;
  oomKillEnabled: boolean;
}

export interface VMStats {
  cpuPercent: number;
  memoryMB: number;
  diskIO: number;
  networkBytes: number;
}

export interface VMMetadata {
  id: string;
  pid: number;
  startTime: number;
  lastActivity: number;
  cgroupPath: string;
  netNsPath: string;
  rootfsPath: string;
  pinnedCores?: number[];
  snapshotPath?: string;
}

export interface SyscallProfile {
  whitelist: string[];
  blacklist: string[];
}
