/**
 * Bucky Node CRUD and DAO Association Operations
 */

import { Pool } from 'pg';
import { BuckyNode, NodeDAO, RegisterNodeInput } from '../types.js';

export class NodeCrud {
  constructor(private pool: Pool) {}

  async register(input: RegisterNodeInput): Promise<BuckyNode> {
    const r = await this.pool.query(
      `INSERT INTO bucky_nodes (name, mesh_id, owner_org_id, owner_user_id, capabilities)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.name, 
        input.meshId ?? null, 
        input.ownerOrgId ?? null, 
        input.ownerUserId ?? null, 
        JSON.stringify(input.capabilities ?? {})
      ]
    );
    return this._mapNode(r.rows[0]);
  }

  async getById(id: string): Promise<BuckyNode | null> {
    const r = await this.pool.query('SELECT * FROM bucky_nodes WHERE id = $1', [id]);
    return r.rows[0] ? this._mapNode(r.rows[0]) : null;
  }

  async getByMeshId(meshId: string): Promise<BuckyNode | null> {
    const r = await this.pool.query('SELECT * FROM bucky_nodes WHERE mesh_id = $1', [meshId]);
    return r.rows[0] ? this._mapNode(r.rows[0]) : null;
  }

  async listByOrg(orgId: string): Promise<BuckyNode[]> {
    const r = await this.pool.query(
      'SELECT * FROM bucky_nodes WHERE owner_org_id = $1 ORDER BY created_at DESC', 
      [orgId]
    );
    return r.rows.map(this._mapNode);
  }

  async updateReputation(nodeId: string, score: number, stakeAmount?: number): Promise<void> {
    if (stakeAmount !== undefined) {
      await this.pool.query(
        'UPDATE bucky_nodes SET reputation_score = $1, stake_amount = $2, updated_at = NOW() WHERE id = $3', 
        [score, stakeAmount, nodeId]
      );
    } else {
      await this.pool.query(
        'UPDATE bucky_nodes SET reputation_score = $1, updated_at = NOW() WHERE id = $2', 
        [score, nodeId]
      );
    }
  }

  async recordEarnings(nodeId: string, amount: number): Promise<void> {
    await this.pool.query(
      'UPDATE bucky_nodes SET earnings_total = earnings_total + $1, updated_at = NOW() WHERE id = $2', 
      [amount, nodeId]
    );
  }

  async updateLastSeen(nodeId: string): Promise<void> {
    await this.pool.query(
      'UPDATE bucky_nodes SET last_seen = NOW(), updated_at = NOW() WHERE id = $1', 
      [nodeId]
    );
  }

  async joinDAO(
    nodeId: string, 
    daoId: string, 
    role: NodeDAO['role'] = 'worker', 
    split?: { worker: number; platform: number; treasury: number }
  ): Promise<void> {
    const s = split ?? { worker: 70, platform: 20, treasury: 10 };
    await this.pool.query(
      `INSERT INTO node_daos (node_id, dao_id, role, worker_revenue_share, platform_revenue_share, treasury_revenue_share)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (node_id, dao_id) DO UPDATE SET 
         role = $3, 
         worker_revenue_share = $4, 
         platform_revenue_share = $5, 
         treasury_revenue_share = $6`,
      [nodeId, daoId, role, s.worker, s.platform, s.treasury]
    );
  }

  async leaveDAO(nodeId: string, daoId: string): Promise<void> {
    await this.pool.query('DELETE FROM node_daos WHERE node_id = $1 AND dao_id = $2', [nodeId, daoId]);
  }

  async getNodeDAOs(nodeId: string): Promise<NodeDAO[]> {
    const r = await this.pool.query('SELECT * FROM node_daos WHERE node_id = $1', [nodeId]);
    return r.rows.map(row => ({
      nodeId: row.node_id,
      daoId: row.dao_id,
      role: row.role,
      workerRevenueShare: row.worker_revenue_share,
      platformRevenueShare: row.platform_revenue_share,
      treasuryRevenueShare: row.treasury_revenue_share,
      joinedAt: row.joined_at
    }));
  }

  async getDAONodes(daoId: string): Promise<NodeDAO[]> {
    const r = await this.pool.query('SELECT * FROM node_daos WHERE dao_id = $1', [daoId]);
    return r.rows.map(row => ({
      nodeId: row.node_id,
      daoId: row.dao_id,
      role: row.role,
      workerRevenueShare: row.worker_revenue_share,
      platformRevenueShare: row.platform_revenue_share,
      treasuryRevenueShare: row.treasury_revenue_share,
      joinedAt: row.joined_at
    }));
  }

  async linkOrgToDAO(orgId: string, daoId: string, role: 'owner' | 'member' = 'member'): Promise<void> {
    await this.pool.query(
      `INSERT INTO org_daos (org_id, dao_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, dao_id) DO UPDATE SET role = $3`,
      [orgId, daoId, role]
    );
  }

  async getOrgDAOs(orgId: string): Promise<Array<{ daoId: string; role: string; joinedAt: Date }>> {
    const r = await this.pool.query('SELECT * FROM org_daos WHERE org_id = $1', [orgId]);
    return r.rows.map(row => ({ daoId: row.dao_id, role: row.role, joinedAt: row.joined_at }));
  }

  private _mapNode(row: any): BuckyNode {
    return {
      id: row.id,
      name: row.name,
      meshId: row.mesh_id,
      ownerOrgId: row.owner_org_id,
      ownerUserId: row.owner_user_id,
      status: row.status,
      reputationScore: row.reputation_score,
      stakeAmount: parseInt(row.stake_amount ?? 0),
      earningsTotal: parseInt(row.earnings_total ?? 0),
      capabilities: row.capabilities ?? {},
      lastSeen: row.last_seen,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
