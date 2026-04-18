/**
 * Proposal CRUD and Voting Operations
 */

import { Pool, PoolClient } from 'pg';
import { Proposal, Vote, CreateProposalInput } from '../types.js';

export class ProposalCrud {
  constructor(private pool: Pool) {}

  async create(input: CreateProposalInput): Promise<Proposal> {
    const result = await this.pool.query<Proposal>(
      `INSERT INTO proposals (dao_id, title, action, target, amount, deadline, proposer_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [input.daoId, input.title, input.action, input.target, input.amount, input.deadline, input.proposerKey]
    );
    return result.rows[0];
  }

  async getById(id: string): Promise<Proposal | null> {
    const result = await this.pool.query<Proposal>(
      'SELECT * FROM proposals WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async listByDAO(daoId: string, status?: string): Promise<Proposal[]> {
    let query = 'SELECT * FROM proposals WHERE dao_id = $1';
    const params: (string | undefined)[] = [daoId];
    
    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';
    
    const result = await this.pool.query<Proposal>(query, params);
    return result.rows;
  }

  async castVote(vote: Vote): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const proposalCheck = await client.query(
        'SELECT status, deadline FROM proposals WHERE id = $1 FOR UPDATE',
        [vote.proposalId]
      );
      
      if (proposalCheck.rows.length === 0) {
        throw new Error('Proposal not found');
      }
      
      const proposal = proposalCheck.rows[0];
      if (proposal.status !== 'active') {
        throw new Error(`Proposal is ${proposal.status}, voting closed`);
      }
      if (new Date() > new Date(proposal.deadline)) {
        throw new Error('Proposal deadline has passed');
      }

      await client.query(
        `INSERT INTO votes (proposal_id, voter_key, support, signature, voted_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (proposal_id, voter_key) DO UPDATE SET
           support = $3,
           signature = $4,
           voted_at = $5`,
        [vote.proposalId, vote.voterKey, vote.support, vote.signature, vote.votedAt]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getVotes(proposalId: string): Promise<Vote[]> {
    const result = await this.pool.query<Vote>(
      'SELECT * FROM votes WHERE proposal_id = $1',
      [proposalId]
    );
    return result.rows;
  }

  async getVoteCount(proposalId: string): Promise<{ yes: number; no: number; total: number }> {
    const result = await this.pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE support = true) as yes_count,
         COUNT(*) FILTER (WHERE support = false) as no_count,
         COUNT(*) as total_count
       FROM votes WHERE proposal_id = $1`,
      [proposalId]
    );
    return {
      yes: parseInt(result.rows[0].yes_count),
      no: parseInt(result.rows[0].no_count),
      total: parseInt(result.rows[0].total_count)
    };
  }
}
