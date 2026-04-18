/**
 * DAO PostgreSQL Types
 * All interfaces for DAO, Organization, Team, Node
 */

import { Pool } from 'pg';

// ─── DAO Types ──────────────────────────────────────────────────────────────

export interface DAO {
  id: string;
  address: string;
  name: string;
  quorum: number;
  threshold: number;
  treasury: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DAOMember {
  daoId: string;
  publicKey: string;
  joinedAt: Date;
  role: 'member' | 'admin';
}

export interface Proposal {
  id: string;
  daoId: string;
  title: string;
  action: string;
  target: string;
  amount?: number;
  status: 'active' | 'passed' | 'rejected' | 'executed' | 'cancelled';
  deadline: Date;
  createdAt: Date;
  executedAt?: Date;
  proposerKey: string;
}

export interface Vote {
  proposalId: string;
  voterKey: string;
  support: boolean;
  signature: string;
  votedAt: Date;
}

export interface TreasuryMovement {
  id: string;
  daoId: string;
  type: 'deposit' | 'withdrawal' | 'proposal_spend';
  amount: number;
  balanceAfter: number;
  proposalId?: string;
  txHash?: string;
  description?: string;
  createdAt: Date;
}

export interface CreateDAOInput {
  address: string;
  name: string;
  quorum: number;
  threshold: number;
  creatorKey: string;
  initialMembers?: string[];
}

export interface CreateProposalInput {
  daoId: string;
  title: string;
  action: string;
  target: string;
  amount?: number;
  deadline: Date;
  proposerKey: string;
}

// ─── Organization Types ───────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  tier: 'free' | 'pro' | 'enterprise';
  billingAddress?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  invitedBy?: string;
  joinedAt: Date;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  ownerId: string;
  tier?: 'free' | 'pro' | 'enterprise';
  billingAddress?: string;
  metadata?: Record<string, any>;
}

// ─── Team Types ───────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: 'lead' | 'member';
  joinedAt: Date;
}

export interface CreateTeamInput {
  orgId: string;
  name: string;
  description?: string;
  metadata?: Record<string, any>;
}

// ─── Bucky Node Types ───────────────────────────────────────────────────────────

export interface BuckyNode {
  id: string;
  name: string;
  meshId?: string;
  ownerOrgId?: string;
  ownerUserId?: string;
  status: 'active' | 'inactive' | 'maintenance' | 'banned';
  reputationScore: number;
  stakeAmount: number;
  earningsTotal: number;
  capabilities: Record<string, any>;
  lastSeen?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NodeDAO {
  nodeId: string;
  daoId: string;
  role: 'worker' | 'validator' | 'admin';
  workerRevenueShare: number;
  platformRevenueShare: number;
  treasuryRevenueShare: number;
  joinedAt: Date;
}

export interface RegisterNodeInput {
  name: string;
  meshId?: string;
  ownerOrgId?: string;
  ownerUserId?: string;
  capabilities?: Record<string, any>;
}

// ─── Persistence Context ──────────────────────────────────────────────────────

export interface PersistenceContext {
  pool: Pool;
  initialized: boolean;
}
