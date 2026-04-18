import type { BuckyNodeConfig } from '../config/index.js';

export interface ServiceContainer {
  dao: any;
  lightning: any;
  mesh: any;
  reputation: any;
  governance: any;
  manufacturingEscrow?: any;
  sandbox: any;
  vmJailer?: any;
  taskManager: any;
  arnikoBridge?: any;
}

let services: ServiceContainer | null = null;

export async function initializeServices(config: BuckyNodeConfig): Promise<ServiceContainer> {
  if (services) return services;

  const { DAOPersistence } = await import('../dao/persistence.js');
  const { BuckyNode } = await import('../mesh/node.js');
  const { LightningService } = await import('../payments/lightning.js');
  const { ReputationManager } = await import('../reputation/manager.js');
  const { GovernanceEngine } = await import('../governance/engine.js');
  const { SandboxManager } = await import('../sandbox/manager.js');
  const { TaskManager } = await import('../tasks/manager.js');
  const { ArnikoBridge } = await import('../bridge/arniko-bridge.js');

  const dao = new DAOPersistence(process.env.DATABASE_URL || '');
  const mesh = new BuckyNode({
    nodeId: config.nodeId,
    listenPort: config.listenPort + 1,
    bootstrapPeers: config.bootstrapPeers,
    stakeAmount: config.stakeAmount,
    capabilities: config.capabilities,
    lightning: config.lightning
  });
  const lightning = new LightningService(config.lightning);
  const reputation = new ReputationManager(dao);
  const governance = new GovernanceEngine({
    quorumPercent: 10, standardThreshold: 60, criticalThreshold: 75,
    votingPeriodMs: 604800000, timelockMs: 172800000, totalSupply: 1000000
  });
  const sandbox = new SandboxManager({
    maxVMs: 4, defaultMemoryMB: 256, defaultVcpus: 1,
    kernelPath: process.env.FIRECRACKER_KERNEL || '/opt/bucky/vmlinux',
    rootfsPath: process.env.FIRECRACKER_ROOTFS || '/opt/bucky/rootfs.ext4'
  });
  const taskManager = new TaskManager(config.nodeId, config.capabilities);
  const arnikoBridge = new ArnikoBridge();

  services = {
    dao,
    mesh,
    lightning,
    reputation,
    governance,
    sandbox,
    taskManager,
    arnikoBridge
  };

  return services;
}

export function getServices(): ServiceContainer {
  if (!services) throw new Error('Services not initialized. Call initializeServices first.');
  return services;
}

export async function shutdownServices(): Promise<void> {
  if (!services) return;
  
  await services.mesh?.stop?.().catch(() => {});
  services = null;
}
