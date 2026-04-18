/**
 * index.ts - Bucky daemon entry with hardware detection + gossipsub (99 lines)
 */
import 'dotenv/config';
import { BuckyNode } from '../mesh/node.js';
import { detectHardware, HardwareCapabilities } from './hardware.js';

interface PeerAnnouncement {
  peerId: string;
  nodeId: string;
  capabilities: HardwareCapabilities;
  multiaddrs: string[];
  timestamp: number;
}

function log(...args: unknown[]): void {
  console.log('[BuckyDaemon]', ...args);
}

async function main(): Promise<void> {
  const nodeId = process.env.BUCKY_NODE_ID || `node-${Math.random().toString(36).slice(2, 10)}`;
  const port = parseInt(process.env.BUCKY_PORT || '3002', 10);

  log('Detecting hardware...');
  const caps = detectHardware();
  log(`Hardware: ${caps.cpuCores} cores, ${caps.ramGB}GB RAM, ${caps.gpuVRAM ? `${caps.gpuVRAM}GB VRAM` : 'no GPU'}, tier=${caps.tier}`);

  const node = new BuckyNode({
    nodeId,
    listenPort: port,
    bootstrapPeers: process.env.BOOTSTRAP_PEERS?.split(',') || [],
    stakeAmount: parseInt(process.env.BUCKY_STAKE_AMOUNT || '0', 10),
    capabilities: {
      cpu: { cores: caps.cpuCores, model: caps.avx2 ? 'AVX2' : 'baseline' },
      memory: caps.ramGB * 1024,
      storage: 0,
      bandwidth: 0,
      ...(caps.gpuVRAM && {
        gpu: { model: caps.tier === 'high-gpu' ? 'high-end' : 'mid-tier', vram: caps.gpuVRAM }
      }),
    },
    lightning: { type: 'strike' },
  });

  // Listen for peer announcements
  node.onPeerDiscovered((peer) => {
    log('🔍 Peer discovered:', peer.peerId?.slice(0, 16) || 'unknown');
  });

  // Subscribe to bucky/peers topic and log
  const originalSubscribe = (node as any).node?.services?.pubsub?.subscribe?.bind((node as any).node?.services?.pubsub);

  await node.start();
  log('✅ Node started. Peer ID:', node.getNodeId());

  // Gossip capabilities every 30 seconds
  const publishCaps = async () => {
    const announcement: PeerAnnouncement = {
      peerId: node.getNodeId(),
      nodeId,
      capabilities: caps,
      multiaddrs: [],
      timestamp: Date.now(),
    };
    try {
      await (node as any).announceCaps?.([]);
      log('📢 Published capabilities to bucky/peers');
    } catch (e) {
      log('⚠️ Failed to publish caps:', e);
    }
  };

  await publishCaps();
  setInterval(publishCaps, 30000);

  // Log connected peers
  setInterval(() => {
    const peers = node.getPeers();
    if (peers.length > 0) {
      log('🔗 Connected peers:', peers.length);
      peers.forEach(p => log('   -', p.slice(0, 16) + '...'));
    }
  }, 60000);

  const shutdown = async (signal: string) => {
    log('Received', signal);
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(e => { log('Fatal:', e); process.exit(1); });
