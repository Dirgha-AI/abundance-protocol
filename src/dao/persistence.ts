/**
 * DAO PostgreSQL Persistence Layer
 * Orchestrates all DAO CRUD operations via modular components
 */

import { Pool } from 'pg';
import { initializeSchema, createIndexes, createTriggers } from './schema.js';
import { DAOCrud } from './modules/dao-crud.js';
import { ProposalCrud } from './modules/proposal-crud.js';
import { TreasuryCrud } from './modules/treasury-crud.js';
import { OrgCrud } from './modules/org-crud.js';
import { TeamCrud } from './modules/team-crud.js';
import { NodeCrud } from './modules/node-crud.js';
import { CreateDAOInput, CreateProposalInput, CreateOrganizationInput, CreateTeamInput, RegisterNodeInput, Vote, OrgMember, TeamMember, NodeDAO } from './types.js';

export class DAOPersistence {
  private pool: Pool;
  private initialized: boolean = false;
  
  // Modular CRUD components
  readonly dao: DAOCrud;
  readonly proposal: ProposalCrud;
  readonly treasury: TreasuryCrud;
  readonly org: OrgCrud;
  readonly team: TeamCrud;
  readonly node: NodeCrud;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://localhost:5432/bucky',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => console.error('PostgreSQL pool error:', err));

    // Initialize modular CRUD components
    this.dao = new DAOCrud(this.pool);
    this.proposal = new ProposalCrud(this.pool);
    this.treasury = new TreasuryCrud(this.pool);
    this.org = new OrgCrud(this.pool);
    this.team = new TeamCrud(this.pool);
    this.node = new NodeCrud(this.pool);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const client = await this.pool.connect();
    try {
      await initializeSchema(client);
      await createIndexes(client);
      await createTriggers(client);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  // ─── Legacy API Compatibility ───────────────────────────────────────────────
  // These methods delegate to modular components for backward compatibility

  async createDAO(input: CreateDAOInput) { return this.dao.create(input); }
  async getDAO(id: string) { return this.dao.getById(id); }
  async getDAOByAddress(address: string) { return this.dao.getByAddress(address); }
  async listDAOs(limit?: number, offset?: number) { return this.dao.list(limit, offset); }
  async getDAOMembers(daoId: string) { return this.dao.getMembers(daoId); }
  async isMember(daoId: string, publicKey: string) { return this.dao.isMember(daoId, publicKey); }
  async addMember(daoId: string, publicKey: string, role?: 'member' | 'admin') { return this.dao.addMember(daoId, publicKey, role); }
  async removeMember(daoId: string, publicKey: string) { return this.dao.removeMember(daoId, publicKey); }

  async createProposal(input: CreateProposalInput) { return this.proposal.create(input); }
  async getProposal(id: string) { return this.proposal.getById(id); }
  async listProposals(daoId: string, status?: string) { return this.proposal.listByDAO(daoId, status); }
  async castVote(vote: Vote) { return this.proposal.castVote(vote); }
  async getVotes(proposalId: string) { return this.proposal.getVotes(proposalId); }
  async getVoteCount(proposalId: string) { return this.proposal.getVoteCount(proposalId); }

  async depositToTreasury(daoId: string, amount: number, txHash?: string, description?: string) {
    return this.treasury.deposit(daoId, amount, txHash, description);
  }
  async getTreasuryBalance(daoId: string) { return this.treasury.getBalance(daoId); }
  async getTreasuryMovements(daoId: string, limit?: number, offset?: number) {
    return this.treasury.getMovements(daoId, limit, offset);
  }
  async verifyTreasuryConsistency(daoId: string) { return this.treasury.verifyConsistency(daoId); }
  async getTreasuryReport(daoId: string) { return this.treasury.getReport(daoId); }

  async createOrganization(input: CreateOrganizationInput) { return this.org.create(input); }
  async getOrganization(id: string) { return this.org.getById(id); }
  async getOrganizationBySlug(slug: string) { return this.org.getBySlug(slug); }
  async listOrganizations(limit?: number, offset?: number) { return this.org.list(limit, offset); }
  async addOrgMember(orgId: string, userId: string, role?: OrgMember['role'], invitedBy?: string) {
    return this.org.addMember(orgId, userId, role, invitedBy);
  }
  async removeOrgMember(orgId: string, userId: string) { return this.org.removeMember(orgId, userId); }
  async getOrgMembers(orgId: string) { return this.org.getMembers(orgId); }
  async isOrgMember(orgId: string, userId: string) { return this.org.isMember(orgId, userId); }

  async createTeam(input: CreateTeamInput) { return this.team.create(input); }
  async getTeam(id: string) { return this.team.getById(id); }
  async listTeamsByOrg(orgId: string) { return this.team.listByOrg(orgId); }
  async addTeamMember(teamId: string, userId: string, role?: TeamMember['role']) {
    return this.team.addMember(teamId, userId, role);
  }
  async removeTeamMember(teamId: string, userId: string) { return this.team.removeMember(teamId, userId); }
  async getTeamMembers(teamId: string) { return this.team.getMembers(teamId); }

  async registerNode(input: RegisterNodeInput) { return this.node.register(input); }
  async getNode(id: string) { return this.node.getById(id); }
  async getNodeByMeshId(meshId: string) { return this.node.getByMeshId(meshId); }
  async listNodesByOrg(orgId: string) { return this.node.listByOrg(orgId); }
  async updateNodeReputation(nodeId: string, score: number, stakeAmount?: number) {
    return this.node.updateReputation(nodeId, score, stakeAmount);
  }
  async recordNodeEarnings(nodeId: string, amount: number) { return this.node.recordEarnings(nodeId, amount); }
  async updateNodeLastSeen(nodeId: string) { return this.node.updateLastSeen(nodeId); }
  async joinDAO(nodeId: string, daoId: string, role?: NodeDAO['role'], split?: any) {
    return this.node.joinDAO(nodeId, daoId, role, split);
  }
  async leaveDAO(nodeId: string, daoId: string) { return this.node.leaveDAO(nodeId, daoId); }
  async getNodeDAOs(nodeId: string) { return this.node.getNodeDAOs(nodeId); }
  async getDAONodes(daoId: string) { return this.node.getDAONodes(daoId); }
  async linkOrgToDAO(orgId: string, daoId: string, role?: 'owner' | 'member') {
    return this.node.linkOrgToDAO(orgId, daoId, role);
  }
  async getOrgDAOs(orgId: string) { return this.node.getOrgDAOs(orgId); }

  // Complex operations that need coordination
  async executeProposal(proposalId: string, executorKey: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const proposalResult = await client.query(
        `SELECT p.*, d.quorum, d.threshold, d.treasury, d.id as dao_id
         FROM proposals p
         JOIN daos d ON p.dao_id = d.id
         WHERE p.id = $1
         FOR UPDATE OF p, d`,
        [proposalId]
      );

      if (proposalResult.rows.length === 0) throw new Error('Proposal not found');

      const proposal = proposalResult.rows[0];
      if (proposal.status !== 'active') throw new Error(`Proposal status is ${proposal.status}`);

      const voteCount = await client.query(
        `SELECT 
           COUNT(*) FILTER (WHERE support = true) as yes_count,
           COUNT(*) as total_count
         FROM votes WHERE proposal_id = $1`,
        [proposalId]
      );

      const yesVotes = parseInt(voteCount.rows[0].yes_count);
      const totalVotes = parseInt(voteCount.rows[0].total_count);

      const memberCount = await client.query(
        'SELECT COUNT(*) as count FROM dao_members WHERE dao_id = $1',
        [proposal.dao_id]
      );
      const totalMembers = parseInt(memberCount.rows[0].count);
      const quorumMet = totalVotes >= Math.ceil(totalMembers * (proposal.quorum / 100));

      if (!quorumMet) {
        await client.query("UPDATE proposals SET status = 'rejected' WHERE id = $1", [proposalId]);
        await client.query('COMMIT');
        throw new Error('Quorum not met');
      }

      const thresholdMet = yesVotes >= proposal.threshold;
      if (!thresholdMet) {
        await client.query("UPDATE proposals SET status = 'rejected' WHERE id = $1", [proposalId]);
        await client.query('COMMIT');
        throw new Error('Threshold not met');
      }

      if (proposal.amount && proposal.amount > proposal.treasury) {
        await client.query("UPDATE proposals SET status = 'rejected' WHERE id = $1", [proposalId]);
        await client.query('COMMIT');
        throw new Error('Insufficient treasury funds');
      }

      await client.query("UPDATE proposals SET status = 'executed', executed_at = NOW() WHERE id = $1", [proposalId]);

      if (proposal.amount) {
        const newBalance = proposal.treasury - proposal.amount;
        await client.query('UPDATE daos SET treasury = $1 WHERE id = $2', [newBalance, proposal.dao_id]);
        await client.query(
          `INSERT INTO treasury_movements (dao_id, type, amount, balance_after, proposal_id, description)
           VALUES ($1, 'proposal_spend', $2, $3, $4, $5)`,
          [proposal.dao_id, proposal.amount, newBalance, proposalId, `Spend: ${proposal.title}`]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Singleton instance
let persistenceInstance: DAOPersistence | null = null;

export function getDAOPersistence(connectionString?: string): DAOPersistence {
  if (!persistenceInstance) {
    persistenceInstance = new DAOPersistence(connectionString);
  }
  return persistenceInstance;
}

export default DAOPersistence;
export type { OrgMember, TeamMember, NodeDAO } from './types.js';
