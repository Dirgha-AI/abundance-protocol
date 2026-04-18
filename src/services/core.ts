import { PeerStore } from '../db/peer-store.js';
import { BuckyNode } from '../mesh/node.js';
import { ConsensusEngine } from '../consensus/engine.js';
import { TaskManager } from '../tasks/manager.js';
import { LightningService } from '../payments/lightning.js';
import { createArnikoMiddleware } from '../middleware/arniko.js';
import { BuckyMeshV01 } from '../mesh-v01/adapter.js';
import { FirecrackerClient } from '../vm/firecracker-client.js';
import { FirecrackerAPI } from '../sandbox/firecracker-client.js';
import { CodeRegistry } from '../code/registry.js';
import { ContentRouter } from '../mesh/routing.js';
import { CodeParser } from '../code/parser.js';
import { SemanticChunker } from '../code/chunker.js';
import { LNDService } from '../payments/lnd.js';
import { LightningV2 } from '../payments/lightning-v2.js';
import { SandboxManager as VMOrchestrator } from '../sandbox/manager.js';
import { Jailer } from '../sandbox/jailer.js';
import { ConsensusVerifier } from '../audit/consensus-verifier.js';
import { ThreatModelScanner } from '../audit/threat-model.js';
import { GovernanceEngine } from '../governance/engine.js';
import { SemanticDedupEngine } from '../code-registry/semantic-dedup.js';
import { MeshLLMProvider } from '../mesh-llm/provider.js';
import type { BuckyNodeConfig } from '../config/index.js';

export interface CoreServices {
  node: BuckyNode;
  peerStore: PeerStore;
  consensus: ConsensusEngine;
  taskManager: TaskManager;
  lightning: LightningService;
  arniko: ReturnType<typeof createArnikoMiddleware>;
  meshV01: BuckyMeshV01;
  firecracker: FirecrackerClient;
  firecrackerAPI: FirecrackerAPI;
  codeRegistry: CodeRegistry;
  contentRouter: ContentRouter;
  lnd: LNDService | null;
  lightningV2: LightningV2;
  vmOrchestrator: VMOrchestrator;
  jailer: Jailer;
  consensusVerifier: ConsensusVerifier;
  threatScanner: ThreatModelScanner;
  governance: GovernanceEngine;
  meshProvider: MeshLLMProvider;
  dedupEngine: SemanticDedupEngine;
}

export function initializeCoreServices(config: BuckyNodeConfig): CoreServices {
  const peerStore = new PeerStore();
  peerStore.init();
  
  const savedPeers = peerStore.getPeers().flatMap(p => p.multiaddrs);
  const bootstrapPeers = [...new Set([...config.bootstrapPeers, ...savedPeers])];

  const node = new BuckyNode({
    nodeId: config.nodeId,
    listenPort: config.listenPort + 1,
    bootstrapPeers,
    stakeAmount: config.stakeAmount,
    capabilities: config.capabilities,
    lightning: config.lightning
  });

  const consensus = new ConsensusEngine(config.nodeId);
  const taskManager = new TaskManager(config.nodeId, config.capabilities);
  const lightning = new LightningService(config.lightning);
  const arniko = createArnikoMiddleware({ autoQuarantine: true });
  const meshV01 = new BuckyMeshV01(config.nodeId, bootstrapPeers);
  const firecracker = new FirecrackerClient();
  const firecrackerAPI = new FirecrackerAPI(process.env.FIRECRACKER_SOCKET || '/var/run/firecracker.sock');
  const codeParser = new CodeParser();
  const chunker = new SemanticChunker(codeParser);
  const codeRegistry = new CodeRegistry(codeParser, chunker);
  
  const lnd = config.lightning.type === 'lnd' && config.lightning.host
    ? new LNDService({ socket: config.lightning.host, macaroon: config.lightning.macaroon || '' })
    : null;
    
  const lightningV2 = new LightningV2(config.lightning);
  const vmOrchestrator = new VMOrchestrator({
    maxVMs: parseInt(process.env.MAX_VMS || '4', 10),
    defaultMemoryMB: 256,
    defaultVcpus: 1,
    kernelPath: process.env.FIRECRACKER_KERNEL || '/opt/bucky/vmlinux',
    rootfsPath: process.env.FIRECRACKER_ROOTFS || '/opt/bucky/rootfs.ext4'
  });
  const jailer = new Jailer();
  const consensusVerifier = new ConsensusVerifier();
  const threatScanner = new ThreatModelScanner();
  const governance = new GovernanceEngine({
    quorumPercent: 10,
    standardThreshold: 60,
    criticalThreshold: 75,
    votingPeriodMs: 604800000,
    timelockMs: 172800000,
    totalSupply: 1000000
  });
  
  const meshProvider = new MeshLLMProvider();
  const dedupEngine = new SemanticDedupEngine();

  return {
    node, peerStore, consensus, taskManager, lightning, arniko,
    meshV01, firecracker, firecrackerAPI, codeRegistry, contentRouter: (() => { const r = new ContentRouter(); r.attach(node); return r; })(),
    lnd, lightningV2, vmOrchestrator, jailer, consensusVerifier, threatScanner,
    governance, meshProvider, dedupEngine
  };
}
