/**
 * Bucky Core Agents — registry and factory.
 *
 * Usage:
 *   import { createDAOAgent, createSecurityAgent, createTreasuryAgent, createRoutingAgent } from './agents/index.js';
 */
export { BuckyAgent } from './base.js';
export type { AgentStatus, AgentMetrics } from './base.js';

export { DAOAgent } from './dao-agent.js';
export type { Proposal, DAOAgentConfig } from './dao-agent.js';

export { SecurityAgent } from './security-agent.js';
export type { ThreatEvent, SecurityAgentConfig } from './security-agent.js';

export { TreasuryAgent } from './treasury-agent.js';
export type { PaymentSplit, TreasuryBalance, TreasuryAgentConfig } from './treasury-agent.js';

export { RoutingAgent } from './routing-agent.js';
export type { WorkerProfile, JobRequest, MatchResult, RoutingAgentConfig } from './routing-agent.js';

// ─── Factory helpers ─────────────────────────────────────────────────────────

import { DAOAgent, type DAOAgentConfig } from './dao-agent.js';
import { SecurityAgent, type SecurityAgentConfig } from './security-agent.js';
import { TreasuryAgent, type TreasuryAgentConfig } from './treasury-agent.js';
import { RoutingAgent, type RoutingAgentConfig } from './routing-agent.js';

export function createDAOAgent(config?: DAOAgentConfig): DAOAgent {
  return new DAOAgent(crypto.randomUUID(), 'DAO-Agent', config);
}

export function createSecurityAgent(config?: SecurityAgentConfig): SecurityAgent {
  return new SecurityAgent(crypto.randomUUID(), 'Security-Agent', config);
}

export function createTreasuryAgent(config?: TreasuryAgentConfig): TreasuryAgent {
  return new TreasuryAgent(crypto.randomUUID(), 'Treasury-Agent', config);
}

export function createRoutingAgent(config?: RoutingAgentConfig): RoutingAgent {
  return new RoutingAgent(crypto.randomUUID(), 'Routing-Agent', config);
}
