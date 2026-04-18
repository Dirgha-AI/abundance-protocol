import type { BuckyNodeConfig, NodeCapabilities, LightningConfig } from './types.js';

export function loadConfig(): BuckyNodeConfig {
  const port = parseInt(process.env.BUCKY_PORT || '4200', 10);
  const envPeers = process.env.BUCKY_BOOTSTRAP_PEERS?.split(',').map(p => p.trim()).filter(Boolean) ?? [];
  const stakeAmount = parseInt(process.env.STAKE_AMOUNT || '10000', 10);
  const nodeId = process.env.BUCKY_NODE_ID || 'node-' + Math.random().toString(36).slice(2, 8);

  const capabilities: NodeCapabilities = {
    cpu: { cores: parseInt(process.env.CPU_CORES || '4', 10), model: process.env.CPU_MODEL || 'default' },
    memory: parseInt(process.env.MEMORY_MB || '8192', 10),
    storage: parseInt(process.env.STORAGE_GB || '100', 10),
    bandwidth: parseInt(process.env.BANDWIDTH_MBPS || '100', 10),
    gpu: process.env.HAS_GPU === 'true' ? { model: process.env.GPU_MODEL || 'unknown', vram: parseInt(process.env.GPU_VRAM_MB || '0', 10) } : undefined
  };

  const lightning: LightningConfig = {
    type: (process.env.LIGHTNING_TYPE as LightningConfig['type']) || 'strike',
    apiKey: process.env.LIGHTNING_API_KEY || '',
    host: process.env.LND_GRPC_HOST || process.env.LND_HOST,
    macaroon: process.env.LND_MACAROON,
    tlsCert: process.env.LND_TLS_CERT
  };

  return {
    nodeId,
    listenPort: port,
    bootstrapPeers: envPeers,
    stakeAmount,
    capabilities,
    lightning
  };
}

export * from './types.js';
