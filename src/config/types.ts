export interface LightningConfig {
  type: 'lnd' | 'strike' | 'cln';
  apiKey?: string;
  host?: string;
  macaroon?: string;
  tlsCert?: string;
}

export interface NodeCapabilities {
  cpu: { cores: number; model: string };
  memory: number;
  storage: number;
  bandwidth: number;
  gpu?: { model: string; vram: number; cudaCores?: number };
}

export interface BuckyNodeConfig {
  nodeId: string;
  listenPort: number;
  bootstrapPeers: string[];
  stakeAmount: number;
  capabilities: NodeCapabilities;
  lightning: LightningConfig;
}

export interface MeshPeer {
  peerId: string;
  addresses: string[];
  capabilities?: NodeCapabilities;
  lastSeen?: number;
}

export interface TaskDefinition {
  id: string;
  description: string;
  budget: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  workerId?: string;
  createdAt: number;
}

export interface ServiceHealth {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  version: string;
  services: Record<string, boolean>;
}
