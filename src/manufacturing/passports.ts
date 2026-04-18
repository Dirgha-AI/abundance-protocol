/**
 * Product Passport Service
 * ERC-1155 product passport minting on Polygon/Base
 * 
 * Creates verifiable digital product passports for manufactured goods:
 * - Unique token ID per product batch
 * - Metadata includes origin, materials, carbon footprint
 * - Transferable but history is immutable
 * - Supports batch minting for production runs
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  Address,
  encodeFunctionData,
  parseEventLogs,
  formatUnits,
  parseUnits
} from 'viem';
import { polygon, polygonAmoy, base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ERC-1155 standard interface
const ERC1155_ABI = [
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'ids', type: 'uint256[]' },
      { name: 'values', type: 'uint256[]' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'mintBatch',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' }
    ],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'id', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'account', type: 'address' },
      { indexed: true, name: 'operator', type: 'address' },
      { indexed: false, name: 'approved', type: 'bool' }
    ],
    name: 'ApprovalForAll',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'operator', type: 'address' },
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'id', type: 'uint256' },
      { indexed: false, name: 'value', type: 'uint256' }
    ],
    name: 'TransferSingle',
    type: 'event'
  }
] as const;

// Product passport metadata
export interface ProductMetadata {
  name: string;
  description: string;
  image: string;              // IPFS hash or URL
  manufacturer: string;       // Company name
  manufacturingDate: string;  // ISO date
  origin: string;             // Country/Region
  materials: MaterialInfo[];
  carbonFootprint: CarbonInfo;
  certifications: Certification[];
  warranty: WarrantyInfo;
  serialNumbers?: string[];   // For batch items
  specifications: Record<string, string>;
}

export interface MaterialInfo {
  name: string;
  percentage: number;
  origin?: string;
  recycled?: boolean;
  certified?: boolean;
}

export interface CarbonInfo {
  totalKg: number;
  manufacturingKg: number;
  transportKg: number;
  offsetKg: number;
  offsetVerified: boolean;
}

export interface Certification {
  name: string;
  issuer: string;
  validUntil: string;
  documentHash?: string;
}

export interface WarrantyInfo {
  durationMonths: number;
  type: 'manufacturer' | 'extended' | 'lifetime';
  terms: string;
}

// Product passport token
export interface ProductPassport {
  tokenId: bigint;
  owner: Address;
  quantity: bigint;
  metadata: ProductMetadata;
  metadataUri: string;
  mintedAt: number;
  history: TransferEvent[];
}

export interface TransferEvent {
  from: Address;
  to: Address;
  quantity: bigint;
  timestamp: number;
  transactionHash: string;
}

export interface MintOptions {
  to: Address;
  quantity: bigint;
  metadata: ProductMetadata;
  batchId?: string;           // Link to manufacturing batch
}

export interface BatchMintOptions {
  to: Address;
  items: { quantity: bigint; metadata: ProductMetadata }[];
  batchId: string;
}

export interface PassportConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  chainId: number;
  contractAddress: Address;
}

export class ProductPassportService {
  private publicClient: any;
  private walletClient: any;
  private contractAddress: Address;
  private chain: typeof polygon | typeof polygonAmoy | typeof base | typeof baseSepolia;
  private metadataCache: Map<string, ProductMetadata> = new Map();

  constructor(config: PassportConfig) {
    // Select chain
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
   * Generate unique token ID for a product
   * Based on manufacturer, batch, and timestamp
   */
  private generateTokenId(manufacturer: string, batchId: string, index: number = 0): bigint {
    const hash = `${manufacturer}-${batchId}-${Date.now()}-${index}`;
    // Create deterministic ID from hash
    let id = 0n;
    for (let i = 0; i < hash.length; i++) {
      id = (id * 31n + BigInt(hash.charCodeAt(i))) & ((1n << 128n) - 1n);
    }
    return id;
  }

  /**
   * Upload metadata to IPFS (simulated)
   * In production, this would use Pinata, NFT.Storage, or similar
   */
  private async uploadMetadata(metadata: ProductMetadata): Promise<string> {
    // Simulate IPFS upload
    const metadataJson = JSON.stringify(metadata);
    const hash = `Qm${Array.from(metadataJson)
      .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
      .toString(16)}${Math.random().toString(16).slice(2, 10)}`;
    
    // Cache metadata
    this.metadataCache.set(hash, metadata);
    
    return `ipfs://${hash}`;
  }

  /**
   * Mint a single product passport
   */
  async mintPassport(options: MintOptions): Promise<{
    tokenId: bigint;
    transactionHash: string;
    metadataUri: string;
  }> {
    const { to, quantity, metadata, batchId } = options;

    // Generate token ID
    const tokenId = this.generateTokenId(metadata.manufacturer, batchId || `solo-${Date.now()}`);

    // Upload metadata
    const metadataUri = await this.uploadMetadata(metadata);

    // Prepare mint data with metadata reference
    const mintData = encodeFunctionData({
      abi: ERC1155_ABI,
      functionName: 'mint',
      args: [to, tokenId, quantity, '0x']
    });

    // In production:
    // const hash = await this.walletClient.writeContract({
    //   address: this.contractAddress,
    //   abi: ERC1155_ABI,
    //   functionName: 'mint',
    //   args: [to, tokenId, quantity, mintData]
    // });
    // const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    // Simulate mint
    await new Promise(r => setTimeout(r, 200));
    const transactionHash = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;

    return {
      tokenId,
      transactionHash,
      metadataUri
    };
  }

  /**
   * Batch mint product passports
   * Efficient for production runs
   */
  async mintBatch(options: BatchMintOptions): Promise<{
    tokenIds: bigint[];
    transactionHash: string;
    metadataUris: string[];
  }> {
    const { to, items, batchId } = options;

    const tokenIds: bigint[] = [];
    const metadataUris: string[] = [];
    const quantities: bigint[] = [];

    // Process all items
    for (let i = 0; i < items.length; i++) {
      const { quantity, metadata } = items[i];
      const tokenId = this.generateTokenId(metadata.manufacturer, batchId, i);
      const metadataUri = await this.uploadMetadata(metadata);

      tokenIds.push(tokenId);
      quantities.push(quantity);
      metadataUris.push(metadataUri);
    }

    // Prepare batch mint data
    const mintData = encodeFunctionData({
      abi: ERC1155_ABI,
      functionName: 'mintBatch',
      args: [to, tokenIds, quantities, '0x']
    });

    // In production:
    // const hash = await this.walletClient.writeContract({
    //   address: this.contractAddress,
    //   abi: ERC1155_ABI,
    //   functionName: 'mintBatch',
    //   args: [to, tokenIds, quantities, '0x']
    // });

    // Simulate batch mint
    await new Promise(r => setTimeout(r, 300));
    const transactionHash = `0x${Date.now().toString(16)}batch${Math.random().toString(16).slice(2, 10)}`;

    return {
      tokenIds,
      transactionHash,
      metadataUris
    };
  }

  /**
   * Transfer a product passport
   */
  async transferPassport(
    from: Address,
    to: Address,
    tokenId: bigint,
    quantity: bigint
  ): Promise<{ transactionHash: string }> {
    // In production:
    // const hash = await this.walletClient.writeContract({
    //   address: this.contractAddress,
    //   abi: ERC1155_ABI,
    //   functionName: 'safeTransferFrom',
    //   args: [from, to, tokenId, quantity, '0x']
    // });

    await new Promise(r => setTimeout(r, 150));
    const transactionHash = `0x${Date.now().toString(16)}xfer${Math.random().toString(16).slice(2, 10)}`;

    return { transactionHash };
  }

  /**
   * Get passport balance for an address
   */
  async getBalance(address: Address, tokenId: bigint): Promise<bigint> {
    // In production:
    // const balance = await this.publicClient.readContract({
    //   address: this.contractAddress,
    //   abi: ERC1155_ABI,
    //   functionName: 'balanceOf',
    //   args: [address, tokenId]
    // });
    // return balance;

    return 1n; // Simulated
  }

  /**
   * Get metadata URI for a token
   */
  async getMetadataUri(tokenId: bigint): Promise<string> {
    // In production:
    // const uri = await this.publicClient.readContract({
    //   address: this.contractAddress,
    //   abi: ERC1155_ABI,
    //   functionName: 'uri',
    //   args: [tokenId]
    // });
    // return uri;

    return `ipfs://QmSimulated${tokenId.toString(16)}`;
  }

  /**
   * Calculate product passport hash for verification
   */
  calculatePassportHash(metadata: ProductMetadata): string {
    const canonical = JSON.stringify(metadata, Object.keys(metadata).sort());
    // Simple hash simulation
    let hash = 0;
    for (let i = 0; i < canonical.length; i++) {
      const char = canonical.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `0x${Math.abs(hash).toString(16).padStart(64, '0')}`;
  }

  /**
   * Verify passport authenticity
   * Checks if metadata hash matches on-chain record
   */
  async verifyPassport(tokenId: bigint, claimedMetadata: ProductMetadata): Promise<{
    valid: boolean;
    reasons?: string[];
  }> {
    const claimedHash = this.calculatePassportHash(claimedMetadata);
    
    // In production: retrieve actual hash from contract or IPFS
    // and compare with claimedHash

    // Simulate verification
    const isValid = Math.random() > 0.1; // 90% pass rate for testing

    return {
      valid: isValid,
      reasons: isValid ? undefined : ['Hash mismatch detected']
    };
  }

  /**
   * Get carbon footprint score
   */
  calculateCarbonScore(metadata: ProductMetadata): number {
    const { carbonFootprint } = metadata;
    const netCarbon = carbonFootprint.totalKg - carbonFootprint.offsetKg;
    const efficiency = carbonFootprint.offsetVerified ? 0.8 : 1.0;
    
    // Score from 0-100, lower carbon = higher score
    const score = Math.max(0, Math.min(100, 100 - (netCarbon * efficiency)));
    return Math.round(score);
  }

  /**
   * Generate sustainability report for a batch
   */
  generateSustainabilityReport(tokens: ProductPassport[]): {
    totalCarbonKg: number;
    recycledPercentage: number;
    certificationsCount: number;
    averageScore: number;
  } {
    let totalCarbon = 0;
    let recycledMaterials = 0;
    let totalMaterials = 0;
    let allCertifications = 0;
    let totalScore = 0;

    for (const token of tokens) {
      const meta = token.metadata;
      totalCarbon += meta.carbonFootprint.totalKg;
      
      for (const mat of meta.materials) {
        totalMaterials++;
        if (mat.recycled) recycledMaterials++;
      }
      
      allCertifications += meta.certifications.length;
      totalScore += this.calculateCarbonScore(meta);
    }

    return {
      totalCarbonKg: totalCarbon,
      recycledPercentage: totalMaterials > 0 ? (recycledMaterials / totalMaterials) * 100 : 0,
      certificationsCount: allCertifications,
      averageScore: tokens.length > 0 ? Math.round(totalScore / tokens.length) : 0
    };
  }
}

// Factory function
export function createPassportService(config: PassportConfig): ProductPassportService {
  return new ProductPassportService(config);
}

export default ProductPassportService;
