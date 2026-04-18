/**
 * Manufacturing Orders Service
 * Lifecycle management for manufacturing orders
 * 
 * Integrates escrow, tracking, and product passports:
 * - Order creation and approval
 * - Escrow funding
 * - Manufacturing tracking
 * - Delivery and completion
 */

import { Address, formatUnits, parseUnits } from 'viem';
import { ManufacturingEscrow, EscrowStatus, POEscrow } from './escrows.js';
import { SupplyChainTracking, SupplyChainStage } from './tracking.js';
import { ProductPassportService, ProductMetadata, MintOptions } from './passports.js';

// Order status
export enum OrderStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  FUNDED = 'funded',
  IN_PRODUCTION = 'in_production',
  PRODUCTION_COMPLETE = 'production_complete',
  SHIPPING = 'shipping',
  DELIVERED = 'delivered',
  COMPLETE = 'complete',
  DISPUTED = 'disputed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded'
}

// Order types
export interface ManufacturingOrder {
  id: string;
  buyer: Address;
  manufacturer: Address;
  productSpecs: ProductSpecification;
  quantity: number;
  unitPrice: bigint;
  totalAmount: bigint;
  status: OrderStatus;
  escrowId?: string;
  trackingIds: string[];
  passportTokenIds: bigint[];
  milestones: Milestone[];
  createdAt: number;
  updatedAt: number;
  deliveryDeadline: number;
  metadata: {
    shippingAddress: string;
    contactEmail: string;
    specialInstructions?: string;
    priority: 'standard' | 'express' | 'rush';
  };
}

export interface ProductSpecification {
  name: string;
  description: string;
  materials: string[];
  dimensions: { length: number; width: number; height: number; unit: string };
  weight: { value: number; unit: string };
  color?: string;
  finish?: string;
  tolerances?: Record<string, string>;
  certificationsRequired: string[];
  qualityStandards: string[];
  ipfsHash?: string;
}

export interface Milestone {
  index: number;
  name: string;
  description: string;
  amount: bigint;
  dueDate: number;
  status: 'pending' | 'in_progress' | 'completed' | 'disputed';
  completedAt?: number;
  evidenceHash?: string;
}

export interface OrderFilters {
  status?: OrderStatus;
  buyer?: Address;
  manufacturer?: Address;
  createdAfter?: number;
  createdBefore?: number;
}

export interface OrderStats {
  totalOrders: number;
  byStatus: Record<OrderStatus, number>;
  totalValue: bigint;
  averageOrderValue: bigint;
  completionRate: number;
  averageProductionTime: number;
}

export interface OrderServices {
  escrow: ManufacturingEscrow;
  tracking: SupplyChainTracking;
  passport: ProductPassportService;
}

export class ManufacturingOrders {
  private orders: Map<string, ManufacturingOrder> = new Map();
  private services: OrderServices;
  private orderCounter = 0;

  constructor(services: OrderServices) {
    this.services = services;
  }

  /**
   * Create a new manufacturing order
   */
  async createOrder(
    buyer: Address,
    manufacturer: Address,
    productSpecs: ProductSpecification,
    quantity: number,
    unitPrice: bigint,
    deliveryDeadline: number,
    metadata: ManufacturingOrder['metadata']
  ): Promise<ManufacturingOrder> {
    const orderId = `order-${++this.orderCounter}-${Date.now()}`;
    const totalAmount = unitPrice * BigInt(quantity);

    // Create default milestones (40% start, 40% completion, 20% delivery)
    const milestones: Milestone[] = [
      {
        index: 0,
        name: 'Production Start',
        description: 'Materials procured, production begins',
        amount: (totalAmount * 40n) / 100n,
        dueDate: deliveryDeadline - (21 * 24 * 60 * 60 * 1000), // 3 weeks before
        status: 'pending'
      },
      {
        index: 1,
        name: 'Production Complete',
        description: 'Manufacturing finished, quality check passed',
        amount: (totalAmount * 40n) / 100n,
        dueDate: deliveryDeadline - (7 * 24 * 60 * 60 * 1000), // 1 week before
        status: 'pending'
      },
      {
        index: 2,
        name: 'Delivery',
        description: 'Product shipped and delivered',
        amount: (totalAmount * 20n) / 100n,
        dueDate: deliveryDeadline,
        status: 'pending'
      }
    ];

    const order: ManufacturingOrder = {
      id: orderId,
      buyer,
      manufacturer,
      productSpecs,
      quantity,
      unitPrice,
      totalAmount,
      status: OrderStatus.DRAFT,
      trackingIds: [],
      passportTokenIds: [],
      milestones,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deliveryDeadline,
      metadata
    };

    this.orders.set(orderId, order);
    return order;
  }

  /**
   * Submit order for approval
   */
  async submitOrder(orderId: string): Promise<ManufacturingOrder> {
    const order = this.getOrder(orderId);
    if (order.status !== OrderStatus.DRAFT) {
      throw new Error('Order must be in draft status to submit');
    }

    order.status = OrderStatus.PENDING_APPROVAL;
    order.updatedAt = Date.now();

    return order;
  }

  /**
   * Approve order (manufacturer side)
   */
  async approveOrder(orderId: string, manufacturerAddress: Address): Promise<ManufacturingOrder> {
    const order = this.getOrder(orderId);
    
    if (order.status !== OrderStatus.PENDING_APPROVAL) {
      throw new Error('Order not awaiting approval');
    }

    if (order.manufacturer.toLowerCase() !== manufacturerAddress.toLowerCase()) {
      throw new Error('Only assigned manufacturer can approve');
    }

    order.status = OrderStatus.APPROVED;
    order.updatedAt = Date.now();

    return order;
  }

  /**
   * Fund order and create escrow
   */
  async fundOrder(orderId: string): Promise<{ order: ManufacturingOrder; escrowId: string }> {
    const order = this.getOrder(orderId);
    
    if (order.status !== OrderStatus.APPROVED) {
      throw new Error('Order must be approved before funding');
    }

    // Create escrow
    const milestoneAmounts = order.milestones.map(m => m.amount);
    
    const { escrowId } = await this.services.escrow.createEscrow(
      order.buyer,
      order.manufacturer,
      order.totalAmount,
      milestoneAmounts,
      order.productSpecs.ipfsHash || '',
      order.deliveryDeadline
    );

    order.escrowId = escrowId;
    order.status = OrderStatus.FUNDED;
    order.updatedAt = Date.now();

    // Initialize tracking for the order
    const trackingId = this.services.tracking.generateProductId(orderId, 0);
    await this.services.tracking.initializeTracking(trackingId, order.manufacturer, order.deliveryDeadline);
    order.trackingIds.push(trackingId);

    return { order, escrowId };
  }

  /**
   * Start production
   */
  async startProduction(orderId: string): Promise<ManufacturingOrder> {
    const order = this.getOrder(orderId);
    
    if (order.status !== OrderStatus.FUNDED) {
      throw new Error('Order must be funded before production');
    }

    order.status = OrderStatus.IN_PRODUCTION;
    order.updatedAt = Date.now();

    // Record tracking checkpoint
    for (const trackingId of order.trackingIds) {
      await this.services.tracking.recordCheckpoint(
        trackingId,
        SupplyChainStage.PRODUCTION_START,
        'Manufacturing Facility',
        { batchNumber: orderId, notes: 'Production started' }
      );
    }

    return order;
  }

  /**
   * Report production progress
   */
  async reportProgress(
    orderId: string,
    progressPercent: number,
    notes?: string
  ): Promise<ManufacturingOrder> {
    const order = this.getOrder(orderId);
    
    if (order.status !== OrderStatus.IN_PRODUCTION) {
      throw new Error('Order not in production');
    }

    // Record manufacturing progress checkpoint
    for (const trackingId of order.trackingIds) {
      await this.services.tracking.recordCheckpoint(
        trackingId,
        SupplyChainStage.MANUFACTURING_PROGRESS,
        'Manufacturing Facility',
        { notes: `${progressPercent}% complete${notes ? `: ${notes}` : ''}` }
      );
    }

    return order;
  }

  /**
   * Complete milestone and release payment
   */
  async completeMilestone(
    orderId: string,
    milestoneIndex: number,
    evidenceHash?: string
  ): Promise<{ order: ManufacturingOrder; releasedAmount: bigint }> {
    const order = this.getOrder(orderId);
    const milestone = order.milestones[milestoneIndex];

    if (!milestone) {
      throw new Error('Milestone not found');
    }

    if (milestone.status !== 'pending' && milestone.status !== 'in_progress') {
      throw new Error('Milestone already completed or disputed');
    }

    // Update milestone
    milestone.status = 'completed';
    milestone.completedAt = Date.now();
    milestone.evidenceHash = evidenceHash;

    // Release escrow payment
    let releasedAmount = 0n;
    if (order.escrowId) {
      const result = await this.services.escrow.releaseMilestone(order.escrowId, milestoneIndex);
      releasedAmount = result.amount;
    }

    // Update order status based on milestone
    if (milestoneIndex === 0) {
      // First milestone - still in production
    } else if (milestoneIndex === 1) {
      order.status = OrderStatus.PRODUCTION_COMPLETE;
      
      // Record tracking checkpoint
      for (const trackingId of order.trackingIds) {
        await this.services.tracking.recordCheckpoint(
          trackingId,
          SupplyChainStage.QUALITY_CONTROL_1,
          'Manufacturing Facility',
          { qualityScore: 95, notes: 'Production complete, QC passed' }
        );
      }
    } else if (milestoneIndex === 2) {
      order.status = OrderStatus.COMPLETE;
      order.updatedAt = Date.now();
    }

    order.updatedAt = Date.now();

    return { order, releasedAmount };
  }

  /**
   * Report shipping
   */
  async reportShipping(
    orderId: string,
    carrier: string,
    trackingNumber: string,
    estimatedDelivery: number
  ): Promise<ManufacturingOrder> {
    const order = this.getOrder(orderId);
    
    if (order.status !== OrderStatus.PRODUCTION_COMPLETE) {
      throw new Error('Order must complete production before shipping');
    }

    order.status = OrderStatus.SHIPPING;
    order.updatedAt = Date.now();

    // Record tracking checkpoints
    for (const trackingId of order.trackingIds) {
      await this.services.tracking.recordCheckpoint(
        trackingId,
        SupplyChainStage.PACKAGING,
        'Manufacturing Facility',
        { notes: `Packed for shipping via ${carrier}` }
      );

      await this.services.tracking.recordCheckpoint(
        trackingId,
        SupplyChainStage.SHIPPING,
        'Distribution Center',
        { notes: `Shipped with ${carrier}, tracking: ${trackingNumber}` }
      );
    }

    return order;
  }

  /**
   * Confirm delivery
   */
  async confirmDelivery(orderId: string): Promise<{ order: ManufacturingOrder; releasedAmount: bigint }> {
    const order = this.getOrder(orderId);
    
    if (order.status !== OrderStatus.SHIPPING && order.status !== OrderStatus.PRODUCTION_COMPLETE) {
      throw new Error('Order not in shipping status');
    }

    order.status = OrderStatus.DELIVERED;
    order.updatedAt = Date.now();

    // Record tracking checkpoint
    for (const trackingId of order.trackingIds) {
      await this.services.tracking.recordCheckpoint(
        trackingId,
        SupplyChainStage.DELIVERY_CONFIRMED,
        order.metadata.shippingAddress,
        { notes: 'Delivery confirmed by buyer' }
      );

      await this.services.tracking.recordCheckpoint(
        trackingId,
        SupplyChainStage.COMPLETED,
        order.metadata.shippingAddress,
        { notes: 'Order complete' }
      );
    }

    // Mint product passports
    const passportTokenIds = await this.mintProductPassports(order);
    order.passportTokenIds = passportTokenIds;

    // Complete final milestone
    return this.completeMilestone(orderId, 2);
  }

  /**
   * Mint product passports for order items
   */
  private async mintProductPassports(order: ManufacturingOrder): Promise<bigint[]> {
    const tokenIds: bigint[] = [];

    // Generate metadata for product passport
    const metadata: ProductMetadata = {
      name: order.productSpecs.name,
      description: order.productSpecs.description,
      image: order.productSpecs.ipfsHash || '',
      manufacturer: 'Manufacturer ' + order.manufacturer.slice(0, 8),
      manufacturingDate: new Date().toISOString(),
      origin: 'Manufacturing Facility',
      materials: order.productSpecs.materials.map(m => ({ name: m, percentage: 100 / order.productSpecs.materials.length })),
      carbonFootprint: {
        totalKg: 10.5,
        manufacturingKg: 8.0,
        transportKg: 2.5,
        offsetKg: 0,
        offsetVerified: false
      },
      certifications: order.productSpecs.certificationsRequired.map(c => ({
        name: c,
        issuer: 'Certification Body',
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      })),
      warranty: {
        durationMonths: 12,
        type: 'manufacturer',
        terms: 'Standard manufacturer warranty'
      },
      specifications: {
        dimensions: `${order.productSpecs.dimensions.length}x${order.productSpecs.dimensions.width}x${order.productSpecs.dimensions.height} ${order.productSpecs.dimensions.unit}`,
        weight: `${order.productSpecs.weight.value} ${order.productSpecs.weight.unit}`,
        color: order.productSpecs.color || 'N/A',
        finish: order.productSpecs.finish || 'N/A'
      }
    };

    // Mint one passport per item in the order
    for (let i = 0; i < order.quantity; i++) {
      const result = await this.services.passport.mintPassport({
        to: order.buyer,
        quantity: 1n,
        metadata,
        batchId: order.id
      });
      tokenIds.push(result.tokenId);
    }

    return tokenIds;
  }

  /**
   * Raise dispute on order
   */
  async raiseDispute(orderId: string, reason: string): Promise<ManufacturingOrder> {
    const order = this.getOrder(orderId);
    
    if (order.status === OrderStatus.COMPLETE || order.status === OrderStatus.CANCELLED) {
      throw new Error('Cannot dispute completed or cancelled order');
    }

    order.status = OrderStatus.DISPUTED;
    order.updatedAt = Date.now();

    // Raise escrow dispute
    if (order.escrowId) {
      await this.services.escrow.raiseDispute(order.escrowId, reason);
    }

    return order;
  }

  /**
   * Resolve dispute with split
   */
  async resolveDispute(
    orderId: string,
    buyerPercent: number
  ): Promise<{ order: ManufacturingOrder; buyerAmount: bigint; manufacturerAmount: bigint }> {
    const order = this.getOrder(orderId);
    
    if (order.status !== OrderStatus.DISPUTED) {
      throw new Error('Order not in disputed status');
    }

    let result: { buyerAmount: bigint; manufacturerAmount: bigint } = { buyerAmount: 0n, manufacturerAmount: 0n };

    if (order.escrowId) {
      result = await this.services.escrow.resolveDispute(order.escrowId, buyerPercent);
    }

    if (buyerPercent === 100) {
      order.status = OrderStatus.REFUNDED;
    } else if (buyerPercent === 0) {
      order.status = OrderStatus.COMPLETE;
    }
    order.updatedAt = Date.now();

    return { order, ...result };
  }

  /**
   * Cancel order (before funding)
   */
  async cancelOrder(orderId: string): Promise<ManufacturingOrder> {
    const order = this.getOrder(orderId);
    
    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.PENDING_APPROVAL) {
      throw new Error('Can only cancel draft or pending orders');
    }

    order.status = OrderStatus.CANCELLED;
    order.updatedAt = Date.now();

    return order;
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): ManufacturingOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    return order;
  }

  /**
   * List orders with filters
   */
  listOrders(filters?: OrderFilters): ManufacturingOrder[] {
    let orders = Array.from(this.orders.values());

    if (filters?.status) {
      orders = orders.filter(o => o.status === filters.status);
    }
    if (filters?.buyer) {
      orders = orders.filter(o => o.buyer.toLowerCase() === filters.buyer?.toLowerCase());
    }
    if (filters?.manufacturer) {
      orders = orders.filter(o => o.manufacturer.toLowerCase() === filters.manufacturer?.toLowerCase());
    }
    if (filters?.createdAfter) {
      orders = orders.filter(o => o.createdAt >= filters.createdAfter!);
    }
    if (filters?.createdBefore) {
      orders = orders.filter(o => o.createdAt <= filters.createdBefore!);
    }

    return orders.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get order statistics
   */
  getStats(): OrderStats {
    const orders = Array.from(this.orders.values());
    const byStatus = {} as Record<OrderStatus, number>;
    
    for (const status of Object.values(OrderStatus)) {
      byStatus[status] = orders.filter(o => o.status === status).length;
    }

    const totalValue = orders.reduce((sum, o) => sum + o.totalAmount, 0n);
    const completedOrders = orders.filter(o => o.status === OrderStatus.COMPLETE);
    
    const avgProductionTime = completedOrders.length > 0
      ? completedOrders.reduce((sum, o) => sum + (o.updatedAt - o.createdAt), 0) / completedOrders.length
      : 0;

    return {
      totalOrders: orders.length,
      byStatus,
      totalValue,
      averageOrderValue: orders.length > 0 ? totalValue / BigInt(orders.length) : 0n,
      completionRate: orders.length > 0 ? completedOrders.length / orders.length : 0,
      averageProductionTime: avgProductionTime
    };
  }

  /**
   * Get order timeline
   */
  getOrderTimeline(orderId: string): {
    stage: string;
    timestamp: number;
    completed: boolean;
    details?: string;
  }[] {
    const order = this.getOrder(orderId);
    const stages = [
      { stage: 'Order Created', timestamp: order.createdAt, completed: true },
      { stage: 'Submitted', timestamp: order.status !== OrderStatus.DRAFT ? order.createdAt + 1000 : 0, completed: order.status !== OrderStatus.DRAFT },
      { stage: 'Approved', timestamp: order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.PENDING_APPROVAL ? order.createdAt + 2000 : 0, completed: order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.PENDING_APPROVAL },
      { stage: 'Funded', timestamp: order.escrowId ? order.createdAt + 3000 : 0, completed: !!order.escrowId },
      { stage: 'Production Started', timestamp: order.status === OrderStatus.IN_PRODUCTION || order.status !== OrderStatus.FUNDED ? order.createdAt + 4000 : 0, completed: order.status !== OrderStatus.FUNDED && order.status !== OrderStatus.APPROVED },
      { stage: 'Production Complete', timestamp: order.status !== OrderStatus.IN_PRODUCTION && order.status !== OrderStatus.FUNDED ? order.createdAt + 5000 : 0, completed: order.status === OrderStatus.PRODUCTION_COMPLETE || order.status === OrderStatus.SHIPPING || order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETE },
      { stage: 'Shipped', timestamp: order.status === OrderStatus.SHIPPING || order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETE ? order.createdAt + 6000 : 0, completed: order.status === OrderStatus.SHIPPING || order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETE },
      { stage: 'Delivered', timestamp: order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETE ? order.createdAt + 7000 : 0, completed: order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETE },
      { stage: 'Complete', timestamp: order.status === OrderStatus.COMPLETE ? order.updatedAt : 0, completed: order.status === OrderStatus.COMPLETE }
    ];

    return stages.filter(s => s.timestamp > 0);
  }

  /**
   * Get order with full details
   */
  getOrderDetails(orderId: string): {
    order: ManufacturingOrder;
    tracking: any;
    escrow: POEscrow | null;
    compliance: any;
  } {
    const order = this.getOrder(orderId);
    
    // Get tracking details
    const tracking = order.trackingIds.map(id => 
      this.services.tracking.getTrackingHistory(id)
    );

    // Get escrow details
    const escrow = order.escrowId ? this.services.escrow.getEscrow(order.escrowId) : null;

    // Get compliance report from first tracking
    const compliance = order.trackingIds.length > 0 
      ? this.services.tracking.generateComplianceReport(order.trackingIds[0])
      : null;

    return {
      order,
      tracking,
      escrow,
      compliance
    };
  }
}

// Factory function
export function createOrdersService(services: OrderServices): ManufacturingOrders {
  return new ManufacturingOrders(services);
}

export default ManufacturingOrders;
