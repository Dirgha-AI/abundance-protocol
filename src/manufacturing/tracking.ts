/**
 * Supply Chain Tracking Service
 * On-chain tracking for manufacturing lifecycle
 * 
 * Tracks products from raw materials to delivery:
 * - Material sourcing provenance
 * - Manufacturing step verification
 * - Quality control checkpoints
 * - Shipping and logistics
 * - Delivery confirmation
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  Address,
  encodeFunctionData,
  keccak256,
  toBytes,
  toHex,
  hexToString,
  stringToHex
} from 'viem';
import { polygon, polygonAmoy, base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Tracking contract ABI (simplified)
const TRACKING_ABI = [
  {
    inputs: [
      { name: 'productId', type: 'bytes32' },
      { name: 'stage', type: 'uint8' },
      { name: 'location', type: 'string' },
      { name: 'actor', type: 'address' },
      { name: 'dataHash', type: 'bytes32' },
      { name: 'timestamp', type: 'uint256' }
    ],
    name: 'recordCheckpoint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'productId', type: 'bytes32' }],
    name: 'getTrackingHistory',
    outputs: [{
      components: [
        { name: 'stage', type: 'uint8' },
        { name: 'location', type: 'string' },
        { name: 'actor', type: 'address' },
        { name: 'dataHash', type: 'bytes32' },
        { name: 'timestamp', type: 'uint256' }
      ],
      name: 'checkpoints',
      type: 'tuple[]'
    }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'productId', type: 'bytes32' },
      { indexed: false, name: 'stage', type: 'uint8' },
      { indexed: true, name: 'actor', type: 'address' },
      { indexed: false, name: 'timestamp', type: 'uint256' }
    ],
    name: 'CheckpointRecorded',
    type: 'event'
  }
] as const;

// Supply chain stages
export enum SupplyChainStage {
  MATERIAL_SOURCING = 0,
  RAW_MATERIAL_VERIFICATION = 1,
  PRODUCTION_START = 2,
  MANUFACTURING_PROGRESS = 3,
  QUALITY_CONTROL_1 = 4,
  QUALITY_CONTROL_2 = 5,
  PACKAGING = 6,
  WAREHOUSING = 7,
  SHIPPING = 8,
  CUSTOMS_CLEARANCE = 9,
  IN_TRANSIT = 10,
  DELIVERY_CONFIRMED = 11,
  COMPLETED = 12,
  DISPUTE = 99
}

export const stageNames: Record<SupplyChainStage, string> = {
  [SupplyChainStage.MATERIAL_SOURCING]: 'Material Sourcing',
  [SupplyChainStage.RAW_MATERIAL_VERIFICATION]: 'Raw Material Verification',
  [SupplyChainStage.PRODUCTION_START]: 'Production Start',
  [SupplyChainStage.MANUFACTURING_PROGRESS]: 'Manufacturing Progress',
  [SupplyChainStage.QUALITY_CONTROL_1]: 'Quality Control - Stage 1',
  [SupplyChainStage.QUALITY_CONTROL_2]: 'Quality Control - Stage 2',
  [SupplyChainStage.PACKAGING]: 'Packaging',
  [SupplyChainStage.WAREHOUSING]: 'Warehousing',
  [SupplyChainStage.SHIPPING]: 'Shipping',
  [SupplyChainStage.CUSTOMS_CLEARANCE]: 'Customs Clearance',
  [SupplyChainStage.IN_TRANSIT]: 'In Transit',
  [SupplyChainStage.DELIVERY_CONFIRMED]: 'Delivery Confirmed',
  [SupplyChainStage.COMPLETED]: 'Completed',
  [SupplyChainStage.DISPUTE]: 'Dispute Raised'
};

// Checkpoint data
export interface Checkpoint {
  stage: SupplyChainStage;
  stageName: string;
  location: string;
  actor: Address;
  dataHash: string;
  timestamp: number;
  metadata?: CheckpointMetadata;
  transactionHash?: string;
}

export interface CheckpointMetadata {
  gpsCoordinates?: { lat: number; lng: number };
  facilityName?: string;
  operatorId?: string;
  batchNumber?: string;
  qualityScore?: number;
  notes?: string;
  attachments?: string[]; // IPFS hashes
  temperatureCelsius?: number;
  humidityPercent?: number;
  weightKg?: number;
  dimensions?: { length: number; width: number; height: number };
}

// Product tracking record
export interface TrackingRecord {
  productId: string;
  checkpoints: Checkpoint[];
  currentStage: SupplyChainStage;
  startedAt: number;
  estimatedCompletion?: number;
  isComplete: boolean;
  participants: Set<Address>;
}

// Actor types
export interface TrackingActor {
  address: Address;
  role: 'manufacturer' | 'shipper' | 'inspector' | 'distributor' | 'buyer';
  name: string;
  verified: boolean;
}

export interface TrackingConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  chainId: number;
  contractAddress: Address;
}

export class SupplyChainTracking {
  private publicClient: any;
  private walletClient: any;
  private contractAddress: Address;
  private chain: typeof polygon | typeof polygonAmoy | typeof base | typeof baseSepolia;
  
  // In-memory storage (would be on-chain in production)
  private trackingRecords: Map<string, TrackingRecord> = new Map();
  private verifiedActors: Map<Address, TrackingActor> = new Map();
  private metadataStore: Map<string, CheckpointMetadata> = new Map();

  constructor(config: TrackingConfig) {
    switch (config.chainId) {
      case polygon.id:
        this.chain = polygon;
        break;
      case polygonAmoy.id:
        this.chain = polygonAmoy;
        break;
      case base.id:
        this.chain = base;
        break;
      case baseSepolia.id:
        this.chain = baseSepolia;
        break;
      default:
        throw new Error(`Unsupported chain ID: ${config.chainId}`);
    }

    this.contractAddress = config.contractAddress;

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
   * Generate unique product ID
   */
  generateProductId(batchId: string, index: number = 0): string {
    const data = `${batchId}-${index}-${Date.now()}`;
    return keccak256(toHex(data));
  }

  /**
   * Register a verified actor
   */
  registerActor(actor: TrackingActor): void {
    this.verifiedActors.set(actor.address, actor);
  }

  /**
   * Check if actor is verified for a role
   */
  isVerifiedActor(address: Address, role?: TrackingActor['role']): boolean {
    const actor = this.verifiedActors.get(address);
    if (!actor) return false;
    if (role) return actor.verified && actor.role === role;
    return actor.verified;
  }

  /**
   * Initialize tracking for a new product
   */
  async initializeTracking(
    productId: string,
    manufacturer: Address,
    estimatedCompletion?: number
  ): Promise<{ transactionHash: string }> {
    const record: TrackingRecord = {
      productId,
      checkpoints: [],
      currentStage: SupplyChainStage.MATERIAL_SOURCING,
      startedAt: Date.now(),
      estimatedCompletion,
      isComplete: false,
      participants: new Set([manufacturer])
    };

    this.trackingRecords.set(productId, record);

    // In production, this would call the contract
    const txHash = `0x${Date.now().toString(16)}init${Math.random().toString(16).slice(2, 10)}`;

    return { transactionHash: txHash };
  }

  /**
   * Record a checkpoint in the supply chain
   */
  async recordCheckpoint(
    productId: string,
    stage: SupplyChainStage,
    location: string,
    metadata?: CheckpointMetadata
  ): Promise<{ transactionHash: string; checkpointIndex: number }> {
    const record = this.trackingRecords.get(productId);
    if (!record) {
      throw new Error(`Product ${productId} not found`);
    }

    if (record.isComplete) {
      throw new Error('Tracking already complete for this product');
    }

    // Verify actor
    const actor = this.walletClient.account!.address;
    if (!this.isVerifiedActor(actor)) {
      throw new Error('Unverified actor');
    }

    // Verify stage progression
    if (stage < record.currentStage && stage !== SupplyChainStage.DISPUTE) {
      throw new Error(`Invalid stage progression: cannot go from ${stageNames[record.currentStage]} to ${stageNames[stage]}`);
    }

    // Calculate data hash from metadata
    const metadataHash = metadata 
      ? keccak256(toHex(JSON.stringify(metadata)))
      : '0x0000000000000000000000000000000000000000000000000000000000000000';

    const checkpoint: Checkpoint = {
      stage,
      stageName: stageNames[stage],
      location,
      actor,
      dataHash: metadataHash,
      timestamp: Date.now(),
      metadata
    };

    // Store metadata
    if (metadata) {
      this.metadataStore.set(metadataHash, metadata);
    }

    // Add to record
    record.checkpoints.push(checkpoint);
    record.currentStage = stage;
    record.participants.add(actor);

    if (stage === SupplyChainStage.COMPLETED) {
      record.isComplete = true;
    }

    // In production:
    // const hash = await this.walletClient.writeContract({
    //   address: this.contractAddress,
    //   abi: TRACKING_ABI,
    //   functionName: 'recordCheckpoint',
    //   args: [
    //     productId as `0x${string}`,
    //     stage,
    //     location,
    //     actor,
    //     metadataHash,
    //     BigInt(Math.floor(Date.now() / 1000))
    //   ]
    // });

    const txHash = `0x${Date.now().toString(16)}cp${record.checkpoints.length}${Math.random().toString(16).slice(2, 8)}`;
    checkpoint.transactionHash = txHash;

    return {
      transactionHash: txHash,
      checkpointIndex: record.checkpoints.length - 1
    };
  }

  /**
   * Get tracking history for a product
   */
  getTrackingHistory(productId: string): TrackingRecord | null {
    return this.trackingRecords.get(productId) || null;
  }

  /**
   * Get checkpoints for a specific stage
   */
  getCheckpointsByStage(productId: string, stage: SupplyChainStage): Checkpoint[] {
    const record = this.trackingRecords.get(productId);
    if (!record) return [];
    return record.checkpoints.filter(cp => cp.stage === stage);
  }

  /**
   * Verify checkpoint integrity
   */
  verifyCheckpoint(checkpoint: Checkpoint): boolean {
    if (!checkpoint.metadata) {
      return checkpoint.dataHash === '0x0000000000000000000000000000000000000000000000000000000000000000';
    }

    const expectedHash = keccak256(toHex(JSON.stringify(checkpoint.metadata)));
    return checkpoint.dataHash === expectedHash;
  }

  /**
   * Get current location of product
   */
  getCurrentLocation(productId: string): string | null {
    const record = this.trackingRecords.get(productId);
    if (!record || record.checkpoints.length === 0) return null;
    
    const lastCheckpoint = record.checkpoints[record.checkpoints.length - 1];
    return lastCheckpoint.location;
  }

  /**
   * Calculate time spent in each stage
   */
  getStageDurations(productId: string): Record<SupplyChainStage, number> {
    const record = this.trackingRecords.get(productId);
    if (!record) return {} as Record<SupplyChainStage, number>;

    const durations: Partial<Record<SupplyChainStage, number>> = {};
    let stageStart = record.startedAt;

    for (const checkpoint of record.checkpoints) {
      durations[checkpoint.stage] = (durations[checkpoint.stage] || 0) + (checkpoint.timestamp - stageStart);
      stageStart = checkpoint.timestamp;
    }

    return durations as Record<SupplyChainStage, number>;
  }

  /**
   * Estimate completion based on historical averages
   */
  estimateCompletion(productId: string, historicalData: TrackingRecord[]): {
    estimatedCompletion: number;
    confidence: number;
    averageDuration: number;
  } {
    const record = this.trackingRecords.get(productId);
    if (!record) throw new Error('Product not found');

    if (historicalData.length === 0) {
      return {
        estimatedCompletion: record.estimatedCompletion || record.startedAt + (30 * 24 * 60 * 60 * 1000),
        confidence: 0.5,
        averageDuration: 30 * 24 * 60 * 60 * 1000
      };
    }

    const completedRecords = historicalData.filter(r => r.isComplete);
    if (completedRecords.length === 0) {
      return {
        estimatedCompletion: record.estimatedCompletion || record.startedAt + (30 * 24 * 60 * 60 * 1000),
        confidence: 0.5,
        averageDuration: 30 * 24 * 60 * 60 * 1000
      };
    }

    const durations = completedRecords.map(r => 
      r.checkpoints[r.checkpoints.length - 1].timestamp - r.startedAt
    );
    
    const averageDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const stdDev = Math.sqrt(durations.reduce((sq, n) => sq + Math.pow(n - averageDuration, 2), 0) / durations.length);
    
    // Higher confidence with more data and lower variance
    const confidence = Math.min(0.95, 0.5 + (completedRecords.length * 0.05) - (stdDev / averageDuration * 0.3));

    return {
      estimatedCompletion: record.startedAt + averageDuration,
      confidence: Math.max(0.1, confidence),
      averageDuration
    };
  }

  /**
   * Generate compliance report
   */
  generateComplianceReport(productId: string): {
    productId: string;
    stagesCompleted: number;
    totalStages: number;
    qualityCheckpoints: number;
    averageQualityScore: number;
    verifiedActors: number;
    temperatureViolations: number;
    totalTransitTime: number;
    issues: string[];
  } {
    const record = this.trackingRecords.get(productId);
    if (!record) throw new Error('Product not found');

    let qualityCheckpoints = 0;
    let qualityScoreSum = 0;
    let temperatureViolations = 0;
    const issues: string[] = [];

    for (const checkpoint of record.checkpoints) {
      if (checkpoint.stage === SupplyChainStage.QUALITY_CONTROL_1 || 
          checkpoint.stage === SupplyChainStage.QUALITY_CONTROL_2) {
        qualityCheckpoints++;
        if (checkpoint.metadata?.qualityScore) {
          qualityScoreSum += checkpoint.metadata.qualityScore;
        }
      }

      if (checkpoint.metadata?.temperatureCelsius !== undefined) {
        // Check for temperature violations (example: > 30°C)
        if (checkpoint.metadata.temperatureCelsius > 30) {
          temperatureViolations++;
          issues.push(`Temperature violation at ${checkpoint.location}: ${checkpoint.metadata.temperatureCelsius}°C`);
        }
      }

      if (!this.verifyCheckpoint(checkpoint)) {
        issues.push(`Data integrity issue at ${checkpoint.stageName}`);
      }
    }

    const totalTransitTime = record.checkpoints.length > 0 
      ? (record.isComplete 
          ? record.checkpoints[record.checkpoints.length - 1].timestamp 
          : Date.now()) - record.startedAt
      : 0;

    return {
      productId,
      stagesCompleted: record.checkpoints.length,
      totalStages: Object.keys(SupplyChainStage).length / 2, // Enum has reverse mapping
      qualityCheckpoints,
      averageQualityScore: qualityCheckpoints > 0 ? qualityScoreSum / qualityCheckpoints : 0,
      verifiedActors: record.participants.size,
      temperatureViolations,
      totalTransitTime,
      issues
    };
  }

  /**
   * Batch record checkpoints for multiple products
   */
  async batchRecordCheckpoints(
    productIds: string[],
    stage: SupplyChainStage,
    location: string,
    metadata?: CheckpointMetadata
  ): Promise<{ 
    transactionHash: string; 
    results: { productId: string; success: boolean; error?: string }[] 
  }> {
    const results: { productId: string; success: boolean; error?: string }[] = [];

    for (const productId of productIds) {
      try {
        await this.recordCheckpoint(productId, stage, location, metadata);
        results.push({ productId, success: true });
      } catch (error: any) {
        results.push({ productId, success: false, error: error.message });
      }
    }

    const txHash = `0x${Date.now().toString(16)}batch${productIds.length}${Math.random().toString(16).slice(2, 8)}`;

    return { transactionHash: txHash, results };
  }

  /**
   * Compare tracking paths for similar products
   */
  comparePaths(productId1: string, productId2: string): {
    similarity: number;
    sharedActors: Address[];
    timeDelta: number;
    pathDeviation: number;
  } {
    const r1 = this.trackingRecords.get(productId1);
    const r2 = this.trackingRecords.get(productId2);
    
    if (!r1 || !r2) {
      throw new Error('One or both products not found');
    }

    // Calculate shared actors
    const sharedActors = Array.from(r1.participants).filter(p => r2.participants.has(p));

    // Calculate stage similarity
    const stages1 = r1.checkpoints.map(cp => cp.stage);
    const stages2 = r2.checkpoints.map(cp => cp.stage);
    const maxStages = Math.max(stages1.length, stages2.length);
    const matchingStages = stages1.filter((s, i) => stages2[i] === s).length;
    const stageSimilarity = maxStages > 0 ? matchingStages / maxStages : 0;

    // Calculate time delta
    const timeDelta = Math.abs(r1.startedAt - r2.startedAt);

    // Path deviation based on location differences
    const locations1 = r1.checkpoints.map(cp => cp.location);
    const locations2 = r2.checkpoints.map(cp => cp.location);
    const matchingLocations = locations1.filter((l, i) => locations2[i] === l).length;
    const locationSimilarity = maxStages > 0 ? matchingLocations / maxStages : 0;

    // Overall similarity
    const similarity = (stageSimilarity + locationSimilarity) / 2;

    return {
      similarity,
      sharedActors,
      timeDelta,
      pathDeviation: 1 - locationSimilarity
    };
  }
}

// Factory function
export function createTrackingService(config: TrackingConfig): SupplyChainTracking {
  return new SupplyChainTracking(config);
}

export default SupplyChainTracking;
