/**
 * DAO PostgreSQL Schema Initialization
 * All CREATE TABLE and INDEX statements
 */

import { PoolClient } from 'pg';

export async function initializeSchema(client: PoolClient): Promise<void> {
  await client.query('BEGIN');

  // DAOs table
  await client.query(`
    CREATE TABLE IF NOT EXISTS daos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      address VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      quorum INTEGER NOT NULL CHECK (quorum > 0),
      threshold INTEGER NOT NULL CHECK (threshold > 0),
      treasury BIGINT DEFAULT 0 CHECK (treasury >= 0),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Members table
  await client.query(`
    CREATE TABLE IF NOT EXISTS dao_members (
      dao_id UUID NOT NULL REFERENCES daos(id) ON DELETE CASCADE,
      public_key VARCHAR(130) NOT NULL,
      role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('member', 'admin')),
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (dao_id, public_key)
    )
  `);

  // Proposals table
  await client.query(`
    CREATE TABLE IF NOT EXISTS proposals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dao_id UUID NOT NULL REFERENCES daos(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      action VARCHAR(100) NOT NULL,
      target VARCHAR(200) NOT NULL,
      amount BIGINT CHECK (amount >= 0),
      status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'passed', 'rejected', 'executed', 'cancelled')),
      deadline TIMESTAMP WITH TIME ZONE NOT NULL,
      proposer_key VARCHAR(130) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      executed_at TIMESTAMP WITH TIME ZONE
    )
  `);

  // Votes table
  await client.query(`
    CREATE TABLE IF NOT EXISTS votes (
      proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      voter_key VARCHAR(130) NOT NULL,
      support BOOLEAN NOT NULL,
      signature VARCHAR(200) NOT NULL,
      voted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (proposal_id, voter_key)
    )
  `);

  // Treasury movements table
  await client.query(`
    CREATE TABLE IF NOT EXISTS treasury_movements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dao_id UUID NOT NULL REFERENCES daos(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'proposal_spend')),
      amount BIGINT NOT NULL,
      balance_after BIGINT NOT NULL,
      proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL,
      tx_hash VARCHAR(100),
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Organizations
  await client.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      owner_id VARCHAR(255) NOT NULL,
      tier VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
      billing_address VARCHAR(100),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS org_members (
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
      invited_by VARCHAR(255),
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (org_id, user_id)
    )
  `);

  // Teams
  await client.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('lead', 'member')),
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (team_id, user_id)
    )
  `);

  // Bucky Nodes
  await client.query(`
    CREATE TABLE IF NOT EXISTS bucky_nodes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      mesh_id VARCHAR(100) UNIQUE,
      owner_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      owner_user_id VARCHAR(255),
      status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'banned')),
      reputation_score FLOAT DEFAULT 0.5 CHECK (reputation_score >= 0 AND reputation_score <= 1),
      stake_amount BIGINT DEFAULT 0,
      earnings_total BIGINT DEFAULT 0,
      capabilities JSONB DEFAULT '{}',
      last_seen TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Node ↔ DAO Associations
  await client.query(`
    CREATE TABLE IF NOT EXISTS node_daos (
      node_id UUID NOT NULL REFERENCES bucky_nodes(id) ON DELETE CASCADE,
      dao_id UUID NOT NULL REFERENCES daos(id) ON DELETE CASCADE,
      role VARCHAR(20) DEFAULT 'worker' CHECK (role IN ('worker', 'validator', 'admin')),
      worker_revenue_share INTEGER DEFAULT 70 CHECK (worker_revenue_share > 0 AND worker_revenue_share <= 100),
      platform_revenue_share INTEGER DEFAULT 20,
      treasury_revenue_share INTEGER DEFAULT 10,
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (node_id, dao_id)
    )
  `);

  // Org ↔ DAO Associations
  await client.query(`
    CREATE TABLE IF NOT EXISTS org_daos (
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      dao_id UUID NOT NULL REFERENCES daos(id) ON DELETE CASCADE,
      role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'member')),
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (org_id, dao_id)
    )
  `);

  await client.query('COMMIT');
}

export async function createIndexes(client: PoolClient): Promise<void> {
  await client.query('BEGIN');

  // DAO indexes
  await client.query('CREATE INDEX IF NOT EXISTS idx_daos_address ON daos(address)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_proposals_dao_id ON proposals(dao_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_votes_proposal_id ON votes(proposal_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_treasury_dao_id ON treasury_movements(dao_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_treasury_created_at ON treasury_movements(created_at)');

  // Org indexes
  await client.query('CREATE INDEX IF NOT EXISTS idx_orgs_slug ON organizations(slug)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_orgs_owner ON organizations(owner_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_nodes_mesh_id ON bucky_nodes(mesh_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_nodes_org ON bucky_nodes(owner_org_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_node_daos_dao ON node_daos(dao_id)');

  await client.query('COMMIT');
}

export async function createTriggers(client: PoolClient): Promise<void> {
  await client.query('BEGIN');

  await client.query(`
    CREATE OR REPLACE FUNCTION update_dao_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await client.query(`
    DROP TRIGGER IF EXISTS update_daos_timestamp ON daos;
    CREATE TRIGGER update_daos_timestamp
      BEFORE UPDATE ON daos
      FOR EACH ROW
      EXECUTE FUNCTION update_dao_timestamp()
  `);

  await client.query('COMMIT');
}
