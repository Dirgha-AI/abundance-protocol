/**
 * DAO CRUD Operations
 * Create, read, update, delete for DAOs and members
 */

import { Pool, PoolClient } from 'pg';
import { DAO, DAOMember, CreateDAOInput } from '../types.js';

export class DAOCrud {
  constructor(private pool: Pool) {}

  async create(input: CreateDAOInput): Promise<DAO> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const daoResult = await client.query<DAO>(
        `INSERT INTO daos (address, name, quorum, threshold)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [input.address, input.name, input.quorum, input.threshold]
      );
      const dao = daoResult.rows[0];

      await client.query(
        `INSERT INTO dao_members (dao_id, public_key, role)
         VALUES ($1, $2, 'admin')`,
        [dao.id, input.creatorKey]
      );

      if (input.initialMembers?.length) {
        const members = input.initialMembers.filter(k => k !== input.creatorKey);
        if (members.length) {
          const values = members.map((_, i) => `($1, $${i + 2}, 'member')`).join(',');
          await client.query(
            `INSERT INTO dao_members (dao_id, public_key, role) VALUES ${values}`,
            [dao.id, ...members]
          );
        }
      }

      await client.query('COMMIT');
      return dao;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<DAO | null> {
    const result = await this.pool.query<DAO>(
      'SELECT * FROM daos WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async getByAddress(address: string): Promise<DAO | null> {
    const result = await this.pool.query<DAO>(
      'SELECT * FROM daos WHERE address = $1',
      [address]
    );
    return result.rows[0] || null;
  }

  async list(limit = 100, offset = 0): Promise<DAO[]> {
    const result = await this.pool.query<DAO>(
      'SELECT * FROM daos ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return result.rows;
  }

  async getMembers(daoId: string): Promise<DAOMember[]> {
    const result = await this.pool.query<DAOMember>(
      'SELECT dao_id, public_key, joined_at, role FROM dao_members WHERE dao_id = $1',
      [daoId]
    );
    return result.rows;
  }

  async isMember(daoId: string, publicKey: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM dao_members WHERE dao_id = $1 AND public_key = $2',
      [daoId, publicKey]
    );
    return result.rows.length > 0;
  }

  async addMember(daoId: string, publicKey: string, role: 'member' | 'admin' = 'member'): Promise<void> {
    await this.pool.query(
      `INSERT INTO dao_members (dao_id, public_key, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (dao_id, public_key) DO UPDATE SET role = $3`,
      [daoId, publicKey, role]
    );
  }

  async removeMember(daoId: string, publicKey: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM dao_members WHERE dao_id = $1 AND public_key = $2',
      [daoId, publicKey]
    );
  }
}
