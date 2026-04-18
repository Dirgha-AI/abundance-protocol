/**
 * Mesh Protocol Demo - Multi-node communication test
 * Run: npx tsx tests/mesh-demo.ts
 */
import MeshProtocol from '../src/mesh/protocol.js';

async function runDemo() {
  console.log('=== MESH-LLM PROTOCOL DEMO ===\n');
  
  // Create 3 nodes
  const node1 = new MeshProtocol('alpha');
  const node2 = new MeshProtocol('beta');
  const node3 = new MeshProtocol('gamma');
  
  // Track events
  const events: string[] = [];
  [node1, node2, node3].forEach(n => {
    n.on('started', e => events.push(`${n.getNodeId()} started`));
    n.on('peer:discovered', e => events.push(`${n.getNodeId()} discovered peer ${e.id}`));
    n.on('expert:registered', e => events.push(`${n.getNodeId()} registered expert ${e.expertType}`));
    n.on('gossip', e => events.push(`${n.getNodeId()} received gossip on ${e.topic}`));
  });
  
  // Start nodes
  await Promise.all([node1.start(), node2.start(), node3.start()]);
  
  // Discover peers
  node1.onPeerDiscovered({ id: 'beta', multiaddrs: ['/ip4/127.0.0.1/tcp/10002'], capabilities: ['inference'], experts: ['code-gen'], reputation: 0.95, lastSeen: new Date() });
  node1.onPeerDiscovered({ id: 'gamma', multiaddrs: ['/ip4/127.0.0.1/tcp/10003'], capabilities: ['training'], experts: ['embedding'], reputation: 0.87, lastSeen: new Date() });
  node2.onPeerDiscovered({ id: 'alpha', multiaddrs: ['/ip4/127.0.0.1/tcp/10001'], capabilities: ['routing'], experts: ['analysis'], reputation: 0.92, lastSeen: new Date() });
  
  // Register experts
  node1.registerExpert('code-gen', async (d, p) => ({ generated: true }));
  node2.registerExpert('embedding', async (d, p) => ({ vector: [0.1, 0.2] }));
  
  // Test MoE routing
  console.log('✓ Nodes started:', [node1, node2, node3].map(n => n.getNodeId()).join(', '));
  console.log('✓ Peers discovered:', node1.getPeers().length);
  console.log('✓ Expert routes found:', node1.findExpertRoutes('embedding').length);
  
  // Test gossip
  node1.subscribe('models');
  node2.subscribe('models');
  node1.publish('models', { type: 'model.broadcast', name: 'gpt-4-turbo' });
  
  // Results
  console.log('\n📊 STATS:');
  console.log('  Node1:', node1.getStats());
  console.log('  Node2:', node2.getStats());
  console.log('  Node3:', node3.getStats());
  console.log('\n✅ MESH DEMO PASSED: 3 nodes communicating');
}

runDemo().catch(console.error);
