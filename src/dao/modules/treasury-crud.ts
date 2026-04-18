/**
 * Treasury Operations and Audit
 */

import { Pool, PoolClient } from 'pg';
import { TreasuryMovement } from '../types.js';

export class TreasuryCrud {
  constructor(private pool: Pool) {}

  async deposit(daoId: string, amount: number, txHash?: string, description?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const daoResult = await client.query(
        'SELECT treasury FROM daos WHERE id = $1 FOR UPDATE',
        [daoId]
      );
      
      if (daoResult.rows.length === 0) throw new Error('DAO not found');

      const currentBalance = parseInt(daoResult.rows[0].treasury);
      const newBalance = currentBalance + amount;

      await client.query('UPDATE daos SET treasury = $1 WHERE id = $2', [newBalance, daoId]);
      await client.query(
        `INSERT INTO treasury_movements (dao_id, type, amount, balance_after, tx_hash, description)
         VALUES ($1, 'deposit', $2, $3, $4, $5)`,
        [daoId, amount, newBalance, txHash, description]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getBalance(daoId: string): Promise<number> {
    const result = await this.pool.query(
      'SELECT treasury FROM daos WHERE id = $1',
      [daoId]
    );
    if (result.rows.length === 0) throw new Error('DAO not found');
    return parseInt(result.rows[0].treasury);
  }

  async getMovements(daoId: string, limit = 100, offset = 0): Promise<TreasuryMovement[]> {
    const result = await this.pool.query<TreasuryMovement>(
      `SELECT * FROM treasury_movements 
       WHERE dao_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [daoId, limit, offset]
    );
    return result.rows;
  }

  async verifyConsistency(daoId: string): Promise<{ consistent: boolean; expected: number; actual: number }> {
    const client = await this.pool.connect();
    try {
      const daoResult = await client.query('SELECT treasury FROM daos WHERE id = $1', [daoId]);
      if (daoResult.rows.length === 0) throw new Error('DAO not found');
      
      const actualBalance = parseInt(daoResult.rows[0].treasury);

      const movementsResult = await client.query(
        `SELECT 
           COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposits,
           COALESCE(SUM(CASE WHEN type IN ('withdrawal', 'proposal_spend') THEN amount ELSE 0 END), 0) as total_spent
         FROM treasury_movements WHERE dao_id = $1`,
        [daoId]
      );

      const deposits = parseInt(movementsResult.rows[0].total_deposits);
      const spent = parseInt(movementsResult.rows[0].total_spent);
      const expectedBalance = deposits - spent;

      return {
        consistent: actualBalance === expectedBalance,
        expected: expectedBalance,
        actual: actualBalance
      };
    } finally {
      client.release();
    }
  }

  async getReport(daoId: string): Promise<{
    balance: number;
    totalDeposits: number;
    totalSpent: number;
    monthlyBurnRate: number;
    runwayMonths: number;
  }> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `WITH monthly_stats AS (
          SELECT 
            DATE_TRUNC('month', created_at) as month,
            SUM(CASE WHEN type IN ('withdrawal', 'proposal_spend') THEN amount ELSE 0 END) as spent
          FROM treasury_movements
          WHERE dao_id = $1 AND created_at > NOW() - INTERVAL '6 months'
          GROUP BY DATE_TRUNC('month', created_at)
        ),
        totals AS (
          SELECT 
            COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposits,
            COALESCE(SUM(CASE WHEN type IN ('withdrawal', 'proposal_spend') THEN amount ELSE 0 END), 0) as total_spent
          FROM treasury_movements WHERE dao_id = $1
        ),
        balance AS (SELECT treasury FROM daos WHERE id = $1)
        SELECT 
          (SELECT treasury FROM balance) as current_balance,
          (SELECT total_deposits FROM totals) as total_deposits,
          (SELECT total_spent FROM totals) as total_spent,
          COALESCE(AVG(spent), 0) as avg_monthly_burn
        FROM monthly_stats`,
        [daoId]
      );

      const row = result.rows[0];
      const balance = parseInt(row.current_balance);
      const monthlyBurnRate = parseFloat(row.avg_monthly_burn);
      const runwayMonths = monthlyBurnRate > 0 ? balance / monthlyBurnRate : Infinity;

      return {
        balance,
        totalDeposits: parseInt(row.total_deposits),
        totalSpent: parseInt(row.total_spent),
        monthlyBurnRate,
        runwayMonths: runwayMonths === Infinity ? 999 : parseFloat(runwayMonths.toFixed(2))
      };
    } finally {
      client.release();
    }
  }

  async executeProposalSpend(
    client: PoolClient,
    proposalId: string,
    daoId: string,
    amount: number,
    title: string
  ): Promise<void> {
    const newBalance = await this.getBalance(daoId) - amount;
    await client.query('UPDATE daos SET treasury = $1 WHERE id = $2', [newBalance, daoId]);
    await client.query(
      `INSERT INTO treasury_movements (dao_id, type, amount, balance_after, proposal_id, description)
       VALUES ($1, 'proposal_spend', $2, $3, $4, $5)`,
      [daoId, amount, newBalance, proposalId, `Spend: ${title}`]
    );
  }
}
