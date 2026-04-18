/** Maturity Scoring System - 0.0-1.0 multi-factor scoring */
import { EventEmitter } from 'events';

export interface MaturityFactors { complexity: number; testCoverage: number; documentation: number; security: number; performance: number; }
export interface MaturityScore { overall: number; factors: MaturityFactors; grade: 'A' | 'B' | 'C' | 'D' | 'F'; gating: 'passed' | 'warning' | 'blocked'; recommendations: string[]; history: Array<{ ts: number; score: number }>; }

export class MaturityScorer extends EventEmitter {
  private scores = new Map<string, MaturityScore>();
  private weights: MaturityFactors = { complexity: 0.2, testCoverage: 0.25, documentation: 0.2, security: 0.25, performance: 0.1 };

  async calc(codeId: string, metrics: Partial<MaturityFactors>): Promise<MaturityScore> {
    const f: MaturityFactors = { complexity: Math.min(1, metrics.complexity ?? 0.5), testCoverage: Math.min(1, metrics.testCoverage ?? 0), documentation: Math.min(1, metrics.documentation ?? 0), security: Math.min(1, metrics.security ?? 0.5), performance: Math.min(1, metrics.performance ?? 0.5) };
    const overall = Object.entries(f).reduce((s, [k, v]) => s + v * this.weights[k as keyof MaturityFactors], 0);
    const score: MaturityScore = { overall, factors: f, grade: this.grade(overall), gating: this.gate(overall, f), recommendations: this.recs(f), history: this.hist(codeId, overall) };
    this.scores.set(codeId, score); this.emit('score:calculated', { codeId, overall }); return score;
  }

  private grade(s: number): MaturityScore['grade'] { if (s >= 0.84) return 'A'; if (s >= 0.77) return 'B'; if (s >= 0.71) return 'C'; if (s >= 0.62) return 'D'; return 'F'; }
  private gate(o: number, f: MaturityFactors): MaturityScore['gating'] { if (o < 0.5 || f.security < 0.4) return 'blocked'; if (o < 0.7 || f.testCoverage < 0.5) return 'warning'; return 'passed'; }
  private recs(f: MaturityFactors): string[] { const r: string[] = []; if (f.testCoverage < 0.7) r.push(`Add ${Math.round((0.7 - f.testCoverage) * 100)}% tests`); if (f.documentation < 0.6) r.push('Add docs'); if (f.security < 0.8) r.push('Fix security'); if (f.complexity > 0.7) r.push('Reduce complexity'); return r; }
  private hist(id: string, s: number): Array<{ ts: number; score: number }> { const e = this.scores.get(id)?.history || []; return [...e, { ts: Date.now(), score: s }].slice(-10); }
  canRegister(id: string): boolean { return this.scores.get(id)?.gating !== 'blocked'; }
  getScore(id: string): MaturityScore | undefined { return this.scores.get(id); }
  getAll(): Array<{ codeId: string; overall: number; grade: string }> { return Array.from(this.scores.entries()).map(([id, s]) => ({ codeId: id, overall: s.overall, grade: s.grade })); }
  getEvolution(id: string): Array<{ ts: number; score: number }> | null { return this.scores.get(id)?.history || null; }
  setWeights(w: Partial<MaturityFactors>): void { this.weights = { ...this.weights, ...w }; const s = Object.values(this.weights).reduce((a, b) => a + b, 0); if (Math.abs(s - 1) > 0.01) throw new Error(`Weights must sum to 1, got ${s}`); }
  stats(): { avg: number; passing: number; blocked: number } { const s = Array.from(this.scores.values()); if (!s.length) return { avg: 0, passing: 0, blocked: 0 }; const avg = s.reduce((a, v) => a + v.overall, 0) / s.length; return { avg, passing: s.filter(x => x.gating === 'passed').length, blocked: s.filter(x => x.gating === 'blocked').length }; }
}

export default MaturityScorer;
