/**
 * Manufacturing Escrow Service
 * Polygon PO (Purchase Order) escrow contracts via viem
 * 
 * Manages secure fund holding during manufacturing lifecycle:
 * - Order placement: Funds locked in escrow
 * - Milestone release: Partial payments on completion
 * - Dispute resolution: Arbitration and refund handling
 */

import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseEther, 
  formatEther,
  Address,
  encodeFunctionData,
  decodeFunctionData
} from 'viem';
import { polygon, polygonAmoy } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Escrow status enum
export enum EscrowStatus {
  PENDING = 'pending',           // Awaiting deposit
  FUNDED = 'funded',             // Funds locked in escrow
  MANUFACTURING = 'manufacturing', // Production in progress
  MILESTONE_1 = 'milestone_1',   // First milestone complete
  MILESTONE_2 = 'milestone_2',   // Second milestone complete
  COMPLETE = 'complete',         // Order fulfilled
  DISPUTED = 'disputed',         // Dispute raised
  REFUNDED = 'refunded',         // Funds returned to buyer
  CANCELLED = 'cancelled'        // Order cancelled
}

// PO Escrow interface
export interface POEscrow {
  id: string;
  buyer: Address;
  manufacturer: Address;
  arbitrator: Address;
  totalAmount: bigint;
  milestoneAmounts: bigint[];
  status: EscrowStatus;
  productSpecs: string;        // IPFS hash of product specifications
  deliveryDeadline: number;    // Unix timestamp
  createdAt: number;
  milestonesCompleted: number;
}

// Escrow ABI (simplified for the interface)
const ESCROW_ABI = [
  {
    inputs: [
      { name: '_manufacturer', type: 'address' },
      { name: '_arbitrator', type: 'address' },
      { name: '_milestones', type: 'uint256[]' },
      { name: '_productSpecs', type: 'string' },
      { name: '_deliveryDeadline', type: 'uint256' }
    ],
    name: 'createEscrow',
    outputs: [{ name: 'escrowId', type: 'bytes32' }],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [{ name: '_escrowId', type: 'bytes32' }],
    name: 'releaseMilestone',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: '_escrowId', type: 'bytes32' },
      { name: '_buyerPercent', type: 'uint256' }
    ],
    name: 'resolveDispute',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: '_escrowId', type: 'bytes32' }],
    name: 'refundBuyer',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: '', type: 'bytes32' }],
    name: 'escrows',
    outputs: [
      { name: 'buyer', type: 'address' },
      { name: 'manufacturer', type: 'address' },
      { name: 'arbitrator', type: 'address' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'releasedAmount', type: 'uint256' },
      { name: 'milestoneCount', type: 'uint8' },
      { name: 'completedMilestones', type: 'uint8' },
      { name: 'status', type: 'uint8' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'bytes32' },
      { indexed: true, name: 'buyer', type: 'address' },
      { indexed: true, name: 'manufacturer', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'EscrowCreated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'bytes32' },
      { name: 'milestone', type: 'uint8' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'MilestoneReleased',
    type: 'event'
  }
] as const;

// Contract addresses by network
const ESCROW_CONTRACTS: Record<number, Address> = {
  [polygon.id]: '0x0000000000000000000000000000000000000000', // TODO: Deploy mainnet
  [polygonAmoy.id]: '0x0000000000000000000000000000000000000000' // TODO: Deploy testnet
};

export interface EscrowConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  chainId: number;
}

export class ManufacturingEscrow {
  private publicClient: any;
  private walletClient: any;
  private chain: typeof polygon | typeof polygonAmoy;
  private contractAddress: Address;
  private pendingEscrows: Map<string, POEscrow> = new Map();

  constructor(config: EscrowConfig) {
    // Select chain based on chainId
    this.chain = config.chainId === polygon.id ? polygon : polygonAmoy;
    this.contractAddress = ESCROW_CONTRACTS[this.chain.id];

    const account = privateKeyToAccount(config.privateKey);

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl)
    });

    this.walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(config.rpcUrl)
    });
  }

  /**
   * Create a new PO escrow contract
   * @param buyer Buyer address
   * @param manufacturer Manufacturer address
   * @param totalAmount Total order amount in wei
   * @param milestoneAmounts Payment amounts per milestone
   * @param productSpecs IPFS hash of product specifications
   * @param deliveryDeadline Unix timestamp for delivery deadline
   */
  async createEscrow(
    buyer: Address,
    manufacturer: Address,
    totalAmount: bigint,
    milestoneAmounts: bigint[],
    productSpecs: string,
    deliveryDeadline: number
  ): Promise<{ escrowId: string; txHash: string }> {
    // Validate milestone amounts sum
    const milestoneSum = milestoneAmounts.reduce((a, b) => a + b, 0n);
    if (milestoneSum > totalAmount) {
      throw new Error(`Milestone sum ${formatEther(milestoneSum)} exceeds total ${formatEther(totalAmount)}`);
    }

    // Use wallet account as arbitrator (can be overridden)
    const arbitrator = this.walletClient.account!.address;

    const escrowId = `escrow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      // Simulate contract call (actual deployment would use real contract)
      const txHash = await this.simulateEscrowCreation({
        buyer,
        manufacturer,
        arbitrator,
        milestoneAmounts,
        productSpecs,
        deliveryDeadline,
        totalAmount
      });

      // Store pending escrow
      const escrow: POEscrow = {
        id: escrowId,
        buyer,
        manufacturer,
        arbitrator,
        totalAmount,
        milestoneAmounts,
        status: EscrowStatus.FUNDED,
        productSpecs,
        deliveryDeadline,
        createdAt: Date.now(),
        milestonesCompleted: 0
      };

      this.pendingEscrows.set(escrowId, escrow);

      return { escrowId, txHash };
    } catch (error) {
      console.error('Escrow creation failed:', error);
      throw error;
    }
  }

  /**
   * Release payment for completed milestone
   * @param escrowId Escrow identifier
   * @param milestoneIndex Which milestone to release (0-indexed)
   */
  async releaseMilestone(escrowId: string, milestoneIndex: number): Promise<{ txHash: string; amount: bigint }> {
    const escrow = this.pendingEscrows.get(escrowId);
    if (!escrow) {
      throw new Error(`Escrow ${escrowId} not found`);
    }

    if (milestoneIndex >= escrow.milestoneAmounts.length) {
      throw new Error(`Invalid milestone index ${milestoneIndex}`);
    }

    if (milestoneIndex < escrow.milestonesCompleted) {
      throw new Error(`Milestone ${milestoneIndex} already released`);
    }

    if (milestoneIndex > escrow.milestonesCompleted) {
      throw new Error(`Previous milestones must be released first`);
    }

    const amount = escrow.milestoneAmounts[milestoneIndex];

    try {
      // Simulate milestone release
      const txHash = await this.simulateMilestoneRelease(escrowId, milestoneIndex, amount);

      // Update escrow state
      escrow.milestonesCompleted++;
      
      // Update status based on progress
      if (escrow.milestonesCompleted === escrow.milestoneAmounts.length) {
        escrow.status = EscrowStatus.COMPLETE;
      } else if (escrow.milestonesCompleted === 1) {
        escrow.status = EscrowStatus.MILESTONE_1;
      } else if (escrow.milestonesCompleted === 2) {
        escrow.status = EscrowStatus.MILESTONE_2;
      }

      return { txHash, amount };
    } catch (error) {
      console.error('Milestone release failed:', error);
      throw error;
    }
  }

  /**
   * Raise a dispute on an escrow
   * @param escrowId Escrow identifier
   * @param reason Dispute reason
   */
  async raiseDispute(escrowId: string, reason: string): Promise<{ txHash: string }> {
    const escrow = this.pendingEscrows.get(escrowId);
    if (!escrow) {
      throw new Error(`Escrow ${escrowId} not found`);
    }

    if (escrow.status === EscrowStatus.DISPUTED) {
      throw new Error('Escrow already disputed');
    }

    if (escrow.status === EscrowStatus.COMPLETE || escrow.status === EscrowStatus.REFUNDED) {
      throw new Error('Cannot dispute completed/refunded escrow');
    }

    // In real implementation, this would call the dispute function
    escrow.status = EscrowStatus.DISPUTED;

    return { txHash: `dispute-${Date.now()}` };
  }

  /**
   * Resolve a disputed escrow (arbitrator only)
   * @param escrowId Escrow identifier
   * @param buyerPercent Percentage to return to buyer (0-100)
   */
  async resolveDispute(escrowId: string, buyerPercent: number): Promise<{ 
    txHash: string; 
    buyerAmount: bigint; 
    manufacturerAmount: bigint 
  }> {
    const escrow = this.pendingEscrows.get(escrowId);
    if (!escrow) {
      throw new Error(`Escrow ${escrowId} not found`);
    }

    if (escrow.status !== EscrowStatus.DISPUTED) {
      throw new Error('Escrow is not in disputed status');
    }

    if (buyerPercent < 0 || buyerPercent > 100) {
      throw new Error('buyerPercent must be between 0 and 100');
    }

    // Calculate split
    const releasedAmount = escrow.milestoneAmounts
      .slice(0, escrow.milestonesCompleted)
      .reduce((a, b) => a + b, 0n);
    
    const remainingAmount = escrow.totalAmount - releasedAmount;
    const buyerAmount = (remainingAmount * BigInt(buyerPercent)) / 100n;
    const manufacturerAmount = remainingAmount - buyerAmount;

    // Update status based on split
    if (buyerPercent === 100) {
      escrow.status = EscrowStatus.REFUNDED;
    } else if (buyerPercent === 0) {
      escrow.status = EscrowStatus.COMPLETE;
    }

    return {
      txHash: `resolve-${Date.now()}`,
      buyerAmount,
      manufacturerAmount
    };
  }

  /**
   * Refund buyer for cancelled or failed order
   * @param escrowId Escrow identifier
   */
  async refundBuyer(escrowId: string): Promise<{ txHash: string; refundAmount: bigint }> {
    const escrow = this.pendingEscrows.get(escrowId);
    if (!escrow) {
      throw new Error(`Escrow ${escrowId} not found`);
    }

    if (escrow.status === EscrowStatus.REFUNDED) {
      throw new Error('Escrow already refunded');
    }

    if (escrow.status === EscrowStatus.COMPLETE) {
      throw new Error('Cannot refund completed escrow');
    }

    // Calculate refund amount (what hasn't been released)
    const releasedAmount = escrow.milestoneAmounts
      .slice(0, escrow.milestonesCompleted)
      .reduce((a, b) => a + b, 0n);
    
    const refundAmount = escrow.totalAmount - releasedAmount;

    escrow.status = EscrowStatus.REFUNDED;

    return {
      txHash: `refund-${Date.now()}`,
      refundAmount
    };
  }

  /**
   * Get escrow details
   */
  getEscrow(escrowId: string): POEscrow | null {
    return this.pendingEscrows.get(escrowId) || null;
  }

  /**
   * List all escrows for an address
   */
  listEscrows(address: Address): POEscrow[] {
    return Array.from(this.pendingEscrows.values()).filter(e => 
      e.buyer.toLowerCase() === address.toLowerCase() ||
      e.manufacturer.toLowerCase() === address.toLowerCase() ||
      e.arbitrator.toLowerCase() === address.toLowerCase()
    );
  }

  /**
   * Check if delivery deadline has passed
   */
  isOverdue(escrowId: string): boolean {
    const escrow = this.pendingEscrows.get(escrowId);
    if (!escrow) return false;
    return Date.now() / 1000 > escrow.deliveryDeadline;
  }

  /**
   * Get released amount so far
   */
  getReleasedAmount(escrowId: string): bigint {
    const escrow = this.pendingEscrows.get(escrowId);
    if (!escrow) return 0n;
    
    return escrow.milestoneAmounts
      .slice(0, escrow.milestonesCompleted)
      .reduce((a, b) => a + b, 0n);
  }

  /**
   * Get remaining amount in escrow
   */
  getRemainingAmount(escrowId: string): bigint {
    const escrow = this.pendingEscrows.get(escrowId);
    if (!escrow) return 0n;
    
    return escrow.totalAmount - this.getReleasedAmount(escrowId);
  }

  // Simulation methods (would be real contract calls in production)
  private async simulateEscrowCreation(params: any): Promise<string> {
    // In production, this would be:
    // const hash = await this.walletClient.writeContract({
    //   address: this.contractAddress,
    //   abi: ESCROW_ABI,
    //   functionName: 'createEscrow',
    //   args: [params.manufacturer, params.arbitrator, params.milestoneAmounts, params.productSpecs, params.deliveryDeadline],
    //   value: params.totalAmount
    // });
    
    await new Promise(r => setTimeout(r, 100)); // Simulate network delay
    return `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  }

  private async simulateMilestoneRelease(escrowId: string, milestone: number, amount: bigint): Promise<string> {
    // In production, this would be:
    // const hash = await this.walletClient.writeContract({
    //   address: this.contractAddress,
    //   abi: ESCROW_ABI,
    //   functionName: 'releaseMilestone',
    //   args: [escrowId as `0x${string}`]
    // });
    
    await new Promise(r => setTimeout(r, 100));
    return `0x${Date.now().toString(16)}m${milestone}${Math.random().toString(16).slice(2, 8)}`;
  }
}

// Factory function
export function createEscrowService(config: EscrowConfig): ManufacturingEscrow {
  return new ManufacturingEscrow(config);
}

export default ManufacturingEscrow;
