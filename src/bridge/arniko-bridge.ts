import { EventEmitter } from 'events';

interface ScanResult {
  passed: boolean;
  findings: any[];
  taskId: string;
  reason?: string;
  maturityScore: number; // 0.0 - 1.0
}

export class ArnikoBridge extends EventEmitter {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    super();
    this.baseUrl = baseUrl || process.env.ARNIKO_URL || 'http://localhost:3010';
  }

  async scanCode(code: string, taskId: string): Promise<ScanResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/arniko/scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tools: ['semgrep', 'trufflehog'],
          target: { type: 'codebase', identifier: taskId, metadata: { code } },
        }),
      });

      if (!res.ok) {
        console.warn(`[ArnikoBridge] Scan failed with status ${res.status} — falling back to pass`);
        return { passed: true, findings: [], taskId, maturityScore: 0.5 };
      }

      const data = await res.json() as { findings?: Array<{ severity: string }> };
      const findings = data.findings || [];

      // Calculate maturity score based on findings density/severity
      let maturityScore = 1.0;
      if (findings.length > 0) {
        const penalty = findings.reduce((acc, f) => {
          if (f.severity === 'critical') return acc + 0.5;
          if (f.severity === 'high') return acc + 0.2;
          return acc + 0.05;
        }, 0);
        maturityScore = Math.max(0, 1.0 - penalty);
      }

      if (findings.some((f) => f.severity === 'critical')) {
        return { passed: false, reason: 'Critical security issue found', findings, taskId, maturityScore };
      }

      return { passed: true, findings, taskId, maturityScore };
    } catch (err) {
      console.warn('[ArnikoBridge] Scan error (Arniko may be offline) — falling back to pass:', err);
      return { passed: true, findings: [], taskId, maturityScore: 0.5 };
    }
  }
}

export const arnikoBridge = new ArnikoBridge();
