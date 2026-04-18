/**
 * Organization CRUD Operations
 */

import { Pool } from 'pg';
import { Organization, OrgMember, CreateOrganizationInput } from '../types.js';

export class OrgCrud {
  constructor(private pool: Pool) {}

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO organizations (name, slug, owner_id, tier, billing_address, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [input.name, input.slug, input.ownerId, input.tier ?? 'free', 
         input.billingAddress ?? null, JSON.stringify(input.metadata ?? {})]
      );
      const org = this._mapOrg(result.rows[0]);
      
      await client.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [org.id, input.ownerId]
      );
      
      await client.query('COMMIT');
      return org;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<Organization | null> {
    const r = await this.pool.query('SELECT * FROM organizations WHERE id = $1', [id]);
    return r.rows[0] ? this._mapOrg(r.rows[0]) : null;
  }

  async getBySlug(slug: string): Promise<Organization | null> {
    const r = await this.pool.query('SELECT * FROM organizations WHERE slug = $1', [slug]);
    return r.rows[0] ? this._mapOrg(r.rows[0]) : null;
  }

  async list(limit = 100, offset = 0): Promise<Organization[]> {
    const r = await this.pool.query(
      'SELECT * FROM organizations ORDER BY created_at DESC LIMIT $1 OFFSET $2', 
      [limit, offset]
    );
    return r.rows.map(this._mapOrg);
  }

  async addMember(orgId: string, userId: string, role: OrgMember['role'] = 'member', invitedBy?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO org_members (org_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = $3`,
      [orgId, userId, role, invitedBy ?? null]
    );
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.pool.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
  }

  async getMembers(orgId: string): Promise<OrgMember[]> {
    const r = await this.pool.query('SELECT * FROM org_members WHERE org_id = $1', [orgId]);
    return r.rows.map(row => ({
      orgId: row.org_id,
      userId: row.user_id,
      role: row.role,
      invitedBy: row.invited_by,
      joinedAt: row.joined_at
    }));
  }

  async isMember(orgId: string, userId: string): Promise<boolean> {
    const r = await this.pool.query(
      'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2', 
      [orgId, userId]
    );
    return r.rows.length > 0;
  }

  private _mapOrg(row: any): Organization {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.owner_id,
      tier: row.tier,
      billingAddress: row.billing_address,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
