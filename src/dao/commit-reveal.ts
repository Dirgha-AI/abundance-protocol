import { createHash } from 'crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROPOSALS_DIR = join(homedir(), '.dirgha', 'proposals');

try {
  mkdirSync(PROPOSALS_DIR, { recursive: true });
} catch {
  // ignore init errors
}

interface CommitRecord {
  commitHash: string;
  timestamp: number;
  type: 'proposal' | 'vote';
  payload: Record<string, unknown>;
}

export function hashProposal(
  daoId: string,
  title: string,
  action: string,
  target: string,
  userId: string,
  timestamp: number
): string {
  const data = JSON.stringify({ daoId, title, action, target, userId, timestamp });
  return createHash('sha256').update(data).digest('hex');
}

export function hashVote(
  propId: string,
  voterKey: string,
  support: boolean,
  timestamp: number
): string {
  const data = JSON.stringify({ propId, voterKey, support, timestamp });
  return createHash('sha256').update(data).digest('hex');
}

export function commitProposal(
  daoId: string,
  title: string,
  action: string,
  target: string,
  userId: string
): CommitRecord {
  const timestamp = Date.now();
  const commitHash = hashProposal(daoId, title, action, target, userId, timestamp);

  const record: CommitRecord = {
    commitHash,
    timestamp,
    type: 'proposal',
    payload: { daoId, title, action, target, userId, timestamp }
  };

  const filePath = join(PROPOSALS_DIR, `${commitHash}.json`);

  try {
    writeFileSync(filePath, JSON.stringify(record, null, 2));
  } catch (error) {
    throw new Error(`Failed to write commit: ${error}`);
  }

  return record;
}

export function commitVote(
  propId: string,
  voterKey: string,
  support: boolean
): CommitRecord {
  const timestamp = Date.now();
  const commitHash = hashVote(propId, voterKey, support, timestamp);

  const record: CommitRecord = {
    commitHash,
    timestamp,
    type: 'vote',
    payload: { propId, voterKey, support, timestamp }
  };

  const filePath = join(PROPOSALS_DIR, `${commitHash}.json`);

  try {
    writeFileSync(filePath, JSON.stringify(record, null, 2));
  } catch (error) {
    throw new Error(`Failed to write commit: ${error}`);
  }

  return record;
}

export function verifyCommit(commitHash: string, payload: Record<string, unknown>): boolean {
  const filePath = join(PROPOSALS_DIR, `${commitHash}.json`);

  try {
    if (!existsSync(filePath)) return false;

    const stored: CommitRecord = JSON.parse(readFileSync(filePath, 'utf-8'));

    let recomputedHash: string;

    if (stored.type === 'proposal') {
      const { daoId, title, action, target, userId, timestamp } = stored.payload;
      recomputedHash = hashProposal(
        daoId as string, title as string, action as string,
        target as string, userId as string, timestamp as number
      );
    } else {
      const { propId, voterKey, support, timestamp } = stored.payload;
      recomputedHash = hashVote(
        propId as string, voterKey as string, support as boolean, timestamp as number
      );
    }

    return stored.commitHash === recomputedHash && stored.timestamp === stored.payload.timestamp;
  } catch {
    return false;
  }
}

export function getCommit(commitHash: string): CommitRecord | null {
  const filePath = join(PROPOSALS_DIR, `${commitHash}.json`);

  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as CommitRecord;
  } catch {
    return null;
  }
}
