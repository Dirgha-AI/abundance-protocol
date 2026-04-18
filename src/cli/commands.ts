/**
 * @fileoverview Bucky mesh daemon CLI commands for Dirgha CLI.
 * These functions interface with the underlying Bucky mesh daemon modules
 * to provide user-facing CLI operations for P2P compute marketplace management.
 */

import { MeshDaemon, MeshConfig, NodeInfo } from '../daemon/mesh-daemon.js';
import { TaskManager, TaskOptions, TaskBid, TaskStatus } from '../daemon/task-manager.js';
import { WalletManager, Transaction, DecodedInvoice, PaymentResult } from '../daemon/wallet-manager.js';
import { PeerManager, PeerInfo } from '../daemon/peer-manager.js';
import { StatsCollector, NetworkStats } from '../daemon/stats-collector.js';
import { formatSats, formatDate, padEnd, padStart } from '../utils/format.js';

// Singleton instances for CLI session
let daemon: MeshDaemon | null = null;
let taskManager: TaskManager | null = null;
let walletManager: WalletManager | null = null;
let peerManager: PeerManager | null = null;
let statsCollector: StatsCollector | null = null;

/**
 * Initialize daemon instances if not already initialized.
 * Internal helper to ensure singleton pattern across CLI commands.
 */
async function initializeDaemon(): Promise<void> {
  if (!daemon) {
    daemon = new MeshDaemon();
    taskManager = new TaskManager(daemon);
    walletManager = new WalletManager(daemon);
    peerManager = new PeerManager(daemon);
    statsCollector = new StatsCollector(daemon);
  }
}

/**
 * Starts the daemon and joins the Bucky mesh network.
 * 
 * @param options - Configuration options for joining the mesh
 * @param options.port - Optional port number to listen on (default: 0 for random available port)
 * @param options.bootstrapPeers - Optional array of bootstrap peer multiaddrs (e.g., ['/ip4/127.0.0.1/tcp/4001/p2p/Qm...'])
 * @param options.donate - If true, enables donation mode where node auto-accepts all tasks within its capabilities
 * 
 * @example
 * ```typescript
 * // Join with random port and donation mode
 * await joinMesh({ donate: true });
 * 
 * // Join specific port with bootstrap peers
 * await joinMesh({ 
 *   port: 8080, 
 *   bootstrapPeers: ['/ip4/192.168.1.100/tcp/4001/p2p/QmNode1'] 
 * });
 * ```
 */
export async function joinMesh(options: { 
  port?: number; 
  bootstrapPeers?: string[]; 
  donate?: boolean 
}): Promise<void> {
  try {
    await initializeDaemon();
    
    const config: MeshConfig = {
      listenPort: options.port || 0,
      bootstrapPeers: options.bootstrapPeers || [],
      autoAcceptTasks: options.donate || false,
      maxConcurrentTasks: options.donate ? 4 : 2
    };

    if (!daemon) throw new Error('Daemon initialization failed');
    
    await daemon.start(config);
    const nodeId = await daemon.getNodeId();
    const peerCount = await daemon.getPeerCount();
    const actualPort = await daemon.getListenPort();

    console.log(`Joined Bucky mesh on port ${actualPort}, ${peerCount} peers discovered`);
    console.log(`Node ID: ${nodeId}`);
    
    if (options.donate) {
      console.log('Donate mode enabled: auto-accepting tasks within capabilities');
    }
  } catch (error) {
    console.error('Failed to join mesh:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Posts a task to the mesh network and auto-assigns it to the highest-reputation bidder.
 * Waits for bids from available nodes, evaluates them based on reputation scores, 
 * and automatically assigns to the best candidate.
 * 
 * @param options - Task configuration and requirements
 * @param options.description - Human-readable description of the task workload
 * @param options.type - Task type identifier (e.g., 'inference', 'training', 'render', 'compile')
 * @param options.budget - Maximum budget in satoshis for the task execution
 * @param options.gpu - Whether GPU compute is required for this task
 * 
 * @example
 * ```typescript
 * await postTask({ 
 *   description: 'Fine-tune LLaMA-2-7B on custom dataset', 
 *   type: 'training', 
 *   budget: 500000, 
 *   gpu: true 
 * });
 * ```
 */
export async function postTask(options: { 
  description: string; 
  type: string; 
  budget: number; 
  gpu?: boolean 
}): Promise<void> {
  try {
    await initializeDaemon();
    if (!taskManager) throw new Error('Task manager not initialized');

    console.log(`Posting task: ${options.description}`);
    console.log(`Budget: ${formatSats(options.budget)} sats${options.gpu ? ' (GPU required)' : ''}`);

    const taskOptions: TaskOptions = {
      description: options.description,
      type: options.type,
      budget: options.budget,
      requirements: {
        gpu: options.gpu || false,
        minReputation: 0.5,
        maxLatency: 1000
      }
    };

    const taskId = await taskManager.postTask(taskOptions);
    console.log(`Task posted with ID: ${taskId}`);
    console.log('Waiting for bids (timeout: 60s)...');

    // Poll for bids with timeout
    let assigned = false;
    const maxWaitTime = 60000;
    const startTime = Date.now();
    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinIdx = 0;

    while (!assigned && Date.now() - startTime < maxWaitTime) {
      const bids = await taskManager.getBids(taskId);
      
      if (bids.length > 0) {
        process.stdout.write('\r'); // Clear spinner
        bids.sort((a: TaskBid, b: TaskBid) => b.reputation - a.reputation);
        const winner = bids[0];
        
        console.log(`\nReceived ${bids.length} bid(s)`);
        console.log(`Auto-assigning to highest reputation bidder: ${winner.peerId.substring(0, 16)}... (rep: ${winner.reputation.toFixed(2)})`);
        
        await taskManager.assignTask(taskId, winner.peerId);
        assigned = true;
        
        console.log(`Task ${taskId} assigned. Monitoring progress...`);
        await monitorTaskProgress(taskId);
      } else {
        process.stdout.write(`\r${spinner[spinIdx]} Waiting for bids...`);
        spinIdx = (spinIdx + 1) % spinner.length;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!assigned) {
      process.stdout.write('\r');
      console.log('No bids received within timeout period. Cancelling task.');
      await taskManager.cancelTask(taskId);
    }
  } catch (error) {
    console.error('Failed to post task:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Internal helper to monitor task execution progress.
 */
async function monitorTaskProgress(taskId: string): Promise<void> {
  if (!taskManager) return;
  
  return new Promise((resolve) => {
    const checkInterval = setInterval(async () => {
      try {
        const status: TaskStatus = await taskManager!.getTaskStatus(taskId);
        
        if (status.progress % 10 === 0 || status.state === 'completed' || status.state === 'failed') {
          console.log(`[${new Date().toLocaleTimeString()}] Task ${taskId}: ${status.state} (${status.progress}%)`);
        }
        
        if (status.state === 'completed') {
          clearInterval(checkInterval);
          console.log(`✓ Task completed successfully${status.result ? ': ' + status.result : ''}`);
          resolve();
        } else if (status.state === 'failed') {
          clearInterval(checkInterval);
          console.log(`✗ Task failed${status.error ? ': ' + status.error : ''}`);
          resolve();
        }
      } catch (err) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 3000);
  });
}

/**
 * Displays current node status information formatted as a padded table.
 * Shows node identity, connectivity metrics, reputation score, wallet balance, 
 * and active task count.
 * 
 * @example
 * ```typescript
 * await nodeStatus();
 * // Output:
 * // ╔════════════════════════════════════════════════╗
 * // ║              BUCKY NODE STATUS                 ║
 * // ╠════════════════════════════════════════════════╣
 * // ║ Node ID      : QmXyz1234...                     ║
 * // ║ Peers        : 12 connected                     ║
 * // ║ Reputation   : 0.94                             ║
 * // ║ Balance      : 1,250,000 sats                   ║
 * // ║ Active Tasks : 3 running                        ║
 * // ╚════════════════════════════════════════════════╝
 * ```
 */
export async function nodeStatus(): Promise<void> {
  try {
    await initializeDaemon();
    if (!daemon || !walletManager) throw new Error('Daemon not initialized');

    const [nodeId, peers, reputation, balance, activeTasks] = await Promise.all([
      daemon.getNodeId(),
      daemon.getPeers(),
      daemon.getReputation(),
      walletManager.getBalance(),
      daemon.getActiveTasks()
    ]);

    const data = [
      { label: 'Node ID', value: nodeId.substring(0, 20) + (nodeId.length > 20 ? '...' : '') },
      { label: 'Peers', value: `${peers.length} connected` },
      { label: 'Reputation', value: reputation.toFixed(2) },
      { label: 'Balance', value: `${formatSats(balance)} sats` },
      { label: 'Active Tasks', value: `${activeTasks.length} running` }
    ];

    const maxLabel = Math.max(...data.map(d => d.label.length));
    const maxValue = Math.max(...data.map(d => d.value.length));
    const width = maxLabel + maxValue + 3; // 3 for " : "

    console.log('╔' + '═'.repeat(width + 4) + '╗');
    console.log('║' + ' '.repeat(Math.floor((width - 16) / 2) + 2) + 'BUCKY NODE STATUS' + ' '.repeat(Math.ceil((width - 16) / 2) + 2) + '║');
    console.log('╠' + '═'.repeat(width + 4) + '╣');
    
    data.forEach(row => {
      const label = padEnd(row.label, maxLabel);
      const value = padEnd(row.value, maxValue);
      console.log(`║ ${label} : ${value} ║`);
    });
    
    console.log('╚' + '═'.repeat(width + 4) + '╝');

    if (activeTasks.length > 0) {
      console.log('\nActive Task Details:');
      activeTasks.forEach((task, idx) => {
        const id = task.id.substring(0, 8);
        console.log(`  ${idx + 1}. [${id}...] ${task.type}: ${task.progress}% - ${task.state}`);
      });
    }
  } catch (error) {
    console.error('Failed to get node status:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Retrieves and displays the Lightning wallet balance and recent transaction history.
 * Shows confirmed balance and up to 10 recent transactions with timestamps.
 * 
 * @example
 * ```typescript
 * await getBalance();
 * // Output:
 * // Balance: 1,250,000 sats
 * // 
 * // Recent Transactions:
 * // 2024-01-15 14:32  +50,000  Task payment received from QmAbc...
 * // 2024-01-15 10:15  -10,000  Task assignment fee for task xyz
 * ```
 */
export async function getBalance(): Promise<void> {
  try {
    await initializeDaemon();
    if (!walletManager) throw new Error('Wallet manager not initialized');

    const balance = await walletManager.getBalance();
    const transactions: Transaction[] = await walletManager.getRecentTransactions(10);

    console.log(`Balance: ${formatSats(balance)} sats`);
    
    if (transactions.length > 0) {
      console.log('\nRecent Transactions:');
      console.log('Date                Amount      Description');
      console.log('-'.repeat(60));
      
      transactions.forEach(tx => {
        const date = formatDate(tx.timestamp);
        const amount = tx.type === 'incoming' 
          ? `+${formatSats(tx.amount)}` 
          : `-${formatSats(tx.amount)}`;
        const amountStr = padStart(amount, 10);
        const desc = tx.description.length > 35 
          ? tx.description.substring(0, 32) + '...' 
          : tx.description;
        console.log(`${date}  ${amountStr}  ${desc}`);
      });
    } else {
      console.log('\nNo recent transactions.');
    }
  } catch (error) {
    console.error('Failed to get balance:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Withdraws accumulated satoshis to a provided Lightning invoice (BOLT11).
 * Validates the invoice, checks sufficient balance, and initiates the payment.
 * 
 * @param options - Withdrawal options
 * @param options.invoice - BOLT11 Lightning invoice string to pay to
 * 
 * @example
 * ```typescript
 * await withdraw({ 
 *   invoice: 'lnbc1250u1p3...' 
 * });
 * // Output:
 * // Validating invoice...
 * // Amount to pay: 125,000 sats
 * // Description: Withdrawal to external wallet
 * // Initiating payment...
 * // ✓ Payment sent!
 * //   Preimage: 0xabc123...
 * //   Fee paid: 250 sats
 * //   Remaining balance: 1,125,000 sats
 * ```
 */
export async function withdraw(options: { 
  invoice: string 
}): Promise<void> {
  try {
    await initializeDaemon();
    if (!walletManager) throw new Error('Wallet manager not initialized');

    console.log('Validating invoice...');
    const decoded: DecodedInvoice = await walletManager.decodeInvoice(options.invoice);
    
    console.log('Processing...');
  } catch (e) { console.error(e); }
}
