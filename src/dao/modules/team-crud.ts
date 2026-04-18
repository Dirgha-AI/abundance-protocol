/**
 * Team CRUD Operations
 */

import { Pool } from 'pg';
import { Team, TeamMember, CreateTeamInput } from '../types.js';

export class TeamCrud {
  constructor(private pool: Pool) {}

  async create(input: CreateTeamInput): Promise<Team> {
    const r = await this.pool.query(
      `INSERT INTO teams (org_id, name, description, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.orgId, input.name, input.description ?? null, JSON.stringify(input.metadata ?? {})]
    );
    return this._mapTeam(r.rows[0]);
  }

  async getById(id: string): Promise<Team | null> {
    const r = await this.pool.query('SELECT * FROM teams WHERE id = $1', [id]);
    return r.rows[0] ? this._mapTeam(r.rows[0]) : null;
  }

  async listByOrg(orgId: string): Promise<Team[]> {
    const r = await this.pool.query(
      'SELECT * FROM teams WHERE org_id = $1 ORDER BY created_at ASC', 
      [orgId]
    );
    return r.rows.map(this._mapTeam);
  }

  async addMember(teamId: string, userId: string, role: TeamMember['role'] = 'member'): Promise<void> {
    await this.pool.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, user_id) DO UPDATE SET role = $3`,
      [teamId, userId, role]
    );
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await this.pool.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
  }

  async getMembers(teamId: string): Promise<TeamMember[]> {
    const r = await this.pool.query('SELECT * FROM team_members WHERE team_id = $1', [teamId]);
    return r.rows.map(row => ({
      teamId: row.team_id,
      userId: row.user_id,
      role: row.role,
      joinedAt: row.joined_at
    }));
  }

  private _mapTeam(row: any): Team {
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      description: row.description,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
