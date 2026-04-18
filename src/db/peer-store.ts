import Database from 'better-sqlite3';

export class PeerStore {
  private db: Database.Database;

  constructor(dbPath: string = './bucky-peers.db') {
    this.db = new Database(dbPath);
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS peers (
        id TEXT PRIMARY KEY,
        multiaddrs TEXT NOT NULL,
        capabilities TEXT,
        lastSeen INTEGER NOT NULL
      )
    `);
  }

  savePeer(id: string, multiaddrs: string[], capabilities?: object): void {
    const stmt = this.db.prepare(`
      INSERT INTO peers (id, multiaddrs, capabilities, lastSeen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        multiaddrs = excluded.multiaddrs,
        capabilities = excluded.capabilities,
        lastSeen = excluded.lastSeen
    `);
    stmt.run(id, JSON.stringify(multiaddrs), capabilities ? JSON.stringify(capabilities) : null, Date.now());
  }

  getPeers(): Array<{id: string, multiaddrs: string[]}> {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare('SELECT id, multiaddrs FROM peers WHERE lastSeen > ?');
    const rows = stmt.all(sevenDaysAgo) as Array<{id: string, multiaddrs: string}>;
    return rows.map(row => ({
      id: row.id,
      multiaddrs: JSON.parse(row.multiaddrs) as string[]
    }));
  }

  removePeer(id: string): void {
    this.db.prepare('DELETE FROM peers WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}

export const peerStore = new PeerStore(process.env.BUCKY_DB_PATH || './bucky-peers.db');
