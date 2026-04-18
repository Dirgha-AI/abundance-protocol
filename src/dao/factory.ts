/**
 * DAO Factory — Persistent implementation backed by PostgreSQL (Neon)
 *
 * Replaces the previous in-memory Map with DAOPersistence so DAO state
 * survives server restarts.  All public functions are now async.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { derive, sign } from '../bitcoin/identity.js';
import { getDAOPersistence } from './persistence.js';

bitcoin.initEccLib(ecc);

// Re-export types from persistence so callers only need to import this file.
export type { DAO, Proposal } from './types.js';

/** Lazily-initialised persistence singleton */
async function db() {
  const p = getDAOPersistence();
  await p.init();
  return p;
}

/**
 * Create a new DAO.
 * The creator's Taproot address is derived from their xprv and stored as the
 * DAO's on-chain address.  The creator's compressed internal key becomes the
 * first admin member.
 */
export async function createDAO(
  creatorXprv: string,
  name: string,
  quorum: number,
  threshold: number,
  members: string[]
): Promise<any> {
  const c = derive(creatorXprv);
  const { address } = bitcoin.payments.p2tr({
    internalPubkey: Buffer.from(c.internalKey, 'hex'),
    network: bitcoin.networks.testnet,
  });

  const p = await db();
  return p.createDAO({
    address: address!,
    name,
    quorum,
    threshold,
    creatorKey: c.internalKey,
    initialMembers: members,
  });
}

/**
 * Add a member to a DAO (admin-only operation).
 * Returns a Bitcoin signature committing to the mint action.
 */
export async function mint(
  daoId: string,
  adminXprv: string,
  memberKey: string
): Promise<string> {
  const p = await db();
  const admin = derive(adminXprv);
  const isAdmin = await p.isMember(daoId, admin.internalKey);
  if (!isAdmin) throw new Error('Auth: caller is not a DAO member');

  await p.addMember(daoId, memberKey, 'member');
  return sign(adminXprv, `mint:${daoId}:${memberKey}`);
}

/**
 * Submit a governance proposal.
 * Returns the created Proposal object.
 */
export async function propose(
  daoId: string,
  proposerXprv: string,
  title: string,
  action: string,
  target: string,
  amount?: number
): Promise<any> {
  const p = await db();
  const proposer = derive(proposerXprv);
  const isMem = await p.isMember(daoId, proposer.internalKey);
  if (!isMem) throw new Error('Member: caller is not a DAO member');

  return p.createProposal({
    daoId,
    title,
    action,
    target,
    amount,
    deadline: new Date(Date.now() + 86_400_000), // 24 h
    proposerKey: proposer.internalKey,
  });
}

/**
 * Cast a vote on a proposal.
 * Returns a Bitcoin signature committing to the vote.
 */
export async function vote(
  daoId: string,
  voterXprv: string,
  propId: string,
  support: boolean
): Promise<string> {
  const p = await db();
  const voter = derive(voterXprv);
  const isMem = await p.isMember(daoId, voter.internalKey);
  if (!isMem) throw new Error('Member: caller is not a DAO member');

  const sig = sign(voterXprv, `vote:${propId}:${support}`);
  await p.castVote({
    proposalId: propId,
    voterKey: voter.internalKey,
    support,
    signature: sig,
    votedAt: new Date(),
  });
  return sig;
}

/**
 * Execute a passed proposal.
 * Returns a Bitcoin signature committing to the execution.
 */
export async function execute(
  daoId: string,
  executorXprv: string,
  propId: string
): Promise<string> {
  const p = await db();
  const executor = derive(executorXprv);
  await p.executeProposal(propId, executor.internalKey);
  return sign(executorXprv, `exec:${propId}`);
}

/** List all DAOs with optional pagination. */
export async function listDAOs(limit = 100, offset = 0): Promise<any[]> {
  const p = await db();
  return p.listDAOs(limit, offset);
}

/** Get a single DAO by ID. */
export async function getDAO(id: string): Promise<any | undefined> {
  const p = await db();
  return (await p.getDAO(id)) ?? undefined;
}
