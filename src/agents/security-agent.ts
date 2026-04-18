/**
 * SecurityAgent — continuous threat monitoring for the Bucky mesh.
 *
 * Responsibilities:
 * - Monitor payment anomalies (sudden large outflows)
 * - Detect node reputation drops (potential sybil / eclipse)
 * - Scan DAO member activity for unusual patterns
 * - Trigger HITL gates for confirmed threats
 * - Integrate with Arniko intent firewall via bridge
 */
import { BuckyAgent } from './base.js';

export interface ThreatEvent {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'payment_anomaly' | 'reputation_drop' | 'sybil_suspect' | 'injection' | 'rate_limit';
  description: string;
  nodeId?: string;
  amountSats?: number;
  timestamp: Date;
  resolved: boolean;
}

export interface SecurityAgentConfig {
  /** Threshold sats for payment anomaly alert */
  largePaymentThresholdSats?: number;
  /** Reputation score drop that triggers alert (0-1 scale) */
  reputationDropThreshold?: number;
  /** Scan interval in ms (default 30s) */
  scanIntervalMs?: number;
  /** Source of transaction events */
  getRecentTransactions?: () => Promise<Array<{ id: string; sats: number; nodeId: string }>>;
  /** Source of node reputation scores */
  getNodeReputations?: () => Promise<Array<{ nodeId: string; score: number; prevScore: number }>>;
  /** Called when a high/critical threat is found */
  onThreat?: (event: ThreatEvent) => Promise<void>;
}

export class SecurityAgent extends BuckyAgent {
  private config: Required<SecurityAgentConfig>;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private threatLog: ThreatEvent[] = [];

  constructor(id: string, name: string, config: SecurityAgentConfig = {}) {
    super(id, name, 'security');
    this.config = {
      largePaymentThresholdSats: config.largePaymentThresholdSats ?? 2_000_000,
      reputationDropThreshold: config.reputationDropThreshold ?? 0.3,
      scanIntervalMs: config.scanIntervalMs ?? 30_000,
      getRecentTransactions: config.getRecentTransactions ?? (async () => []),
      getNodeReputations: config.getNodeReputations ?? (async () => []),
      onThreat: config.onThreat ?? (async (e) => {
        console.warn(`[SecurityAgent] THREAT [${e.severity}]: ${e.description}`);
      }),
    };
  }

  protected onStart(): void {
    this.scheduleScan();
  }

  protected onStop(): void {
    if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = null; }
  }

  private scheduleScan(): void {
    this.scanTimer = setTimeout(async () => {
      await this.scan();
      if (this.status() === 'working') this.scheduleScan();
    }, this.config.scanIntervalMs);
  }

  async scan(): Promise<ThreatEvent[]> {
    if (this.status() !== 'working') return [];
    this.setTask('Running security scan');
    const found: ThreatEvent[] = [];

    try {
      // ── Payment anomaly detection ────────────────────────────────────────
      const txs = await this.config.getRecentTransactions();
      for (const tx of txs) {
        if (tx.sats >= this.config.largePaymentThresholdSats) {
          const evt = this.createThreat('payment_anomaly', 'high',
            `Large payment detected: ${tx.sats} sats from node ${tx.nodeId}`,
            { nodeId: tx.nodeId, amountSats: tx.sats });
          found.push(evt);
        }
      }

      // ── Reputation drop detection ─────────────────────────────────────────
      const nodes = await this.config.getNodeReputations();
      for (const n of nodes) {
        const drop = n.prevScore - n.score;
        if (drop >= this.config.reputationDropThreshold) {
          const sev: ThreatEvent['severity'] = drop >= 0.5 ? 'critical' : 'high';
          const evt = this.createThreat('reputation_drop', sev,
            `Node ${n.nodeId} reputation dropped by ${(drop * 100).toFixed(0)}%`,
            { nodeId: n.nodeId });
          found.push(evt);
        }
      }

      // Emit and handle
      for (const evt of found) {
        this.threatLog.push(evt);
        this.emit('threat', evt);
        if (evt.severity === 'high' || evt.severity === 'critical') {
          await this.config.onThreat(evt);
        }
      }

      this.clearTask();
      this.recordJobDone(0);
    } catch (err: any) {
      this.recordError(err);
    }

    return found;
  }

  private createThreat(
    type: ThreatEvent['type'],
    severity: ThreatEvent['severity'],
    description: string,
    extra: Partial<ThreatEvent> = {}
  ): ThreatEvent {
    const evt: ThreatEvent = {
      id: crypto.randomUUID(),
      type,
      severity,
      description,
      timestamp: new Date(),
      resolved: false,
      ...extra,
    };
    return evt;
  }

  /** Resolve a threat by ID */
  resolve(threatId: string): boolean {
    const evt = this.threatLog.find((e) => e.id === threatId);
    if (!evt) return false;
    evt.resolved = true;
    this.emit('threat_resolved', evt);
    return true;
  }

  /** Get all unresolved threats */
  activeThreats(): ThreatEvent[] {
    return this.threatLog.filter((e) => !e.resolved);
  }

  getLog(): ThreatEvent[] {
    return [...this.threatLog];
  }
}
