/**
 * Maturity Scoring System Tests
 * 0.0-1.0 multi-factor scoring verification
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MaturityScorer } from '../../src/code-registry/maturity';

describe('MaturityScorer', () => {
  let scorer: MaturityScorer;

  beforeEach(() => {
    scorer = new MaturityScorer();
  });

  it('should calculate overall score from factors', async () => {
    const score = await scorer.calc('test-1', {
      complexity: 0.5,
      testCoverage: 0.8,
      documentation: 0.7,
      security: 0.9,
      performance: 0.6,
    });

    expect(score.overall).toBeGreaterThan(0);
    expect(score.overall).toBeLessThanOrEqual(1);
    expect(score.factors.testCoverage).toBe(0.8);
  });

  it('should assign grades correctly', async () => {
    const tests = [
      { metrics: { testCoverage: 0.95, security: 0.95, complexity: 0.5, documentation: 0.9, performance: 0.9 }, expected: 'A' },
      { metrics: { testCoverage: 0.85, security: 0.85, complexity: 0.6, documentation: 0.8, performance: 0.8 }, expected: 'B' },
      { metrics: { testCoverage: 0.75, security: 0.75, complexity: 0.7, documentation: 0.7, performance: 0.7 }, expected: 'C' },
      { metrics: { testCoverage: 0.65, security: 0.65, complexity: 0.8, documentation: 0.6, performance: 0.6 }, expected: 'D' },
      { metrics: { testCoverage: 0.4, security: 0.4, complexity: 0.9, documentation: 0.3, performance: 0.4 }, expected: 'F' },
    ];

    for (const { metrics, expected } of tests) {
      const score = await scorer.calc(`test-${expected}`, metrics as any);
      expect(score.grade).toBe(expected);
    }
  });

  it('should apply dynamic gating', async () => {
    // Blocked: low overall or low security
    const blocked = await scorer.calc('blocked', {
      testCoverage: 0.3,
      security: 0.3,
      complexity: 0.9,
      documentation: 0.2,
      performance: 0.5,
    });
    expect(blocked.gating).toBe('blocked');
    expect(scorer.canRegister('blocked')).toBe(false);

    // Warning: medium scores
    const warning = await scorer.calc('warning', {
      testCoverage: 0.6,
      security: 0.7,
      complexity: 0.6,
      documentation: 0.6,
      performance: 0.6,
    });
    expect(warning.gating).toBe('warning');
    expect(scorer.canRegister('warning')).toBe(true);

    // Passed: high scores
    const passed = await scorer.calc('passed', {
      testCoverage: 0.9,
      security: 0.9,
      complexity: 0.5,
      documentation: 0.8,
      performance: 0.8,
    });
    expect(passed.gating).toBe('passed');
    expect(scorer.canRegister('passed')).toBe(true);
  });

  it('should provide recommendations', async () => {
    const score = await scorer.calc('recommendations', {
      testCoverage: 0.5,
      security: 0.7,
      complexity: 0.8,
      documentation: 0.4,
      performance: 0.6,
    });

    expect(score.recommendations.length).toBeGreaterThan(0);
    // Should recommend adding tests
    expect(score.recommendations.some(r => r.includes('tests'))).toBe(true);
  });

  it('should track score history', async () => {
    const id = 'history-test';
    
    await scorer.calc(id, { testCoverage: 0.5, security: 0.5 } as any);
    await scorer.calc(id, { testCoverage: 0.6, security: 0.6 } as any);
    await scorer.calc(id, { testCoverage: 0.7, security: 0.7 } as any);

    const evolution = scorer.getEvolution(id);
    expect(evolution).not.toBeNull();
    expect(evolution!.length).toBe(3);
  });

  it('should limit history to last 10 entries', async () => {
    const id = 'history-limit';
    
    for (let i = 0; i < 15; i++) {
      await scorer.calc(id, { testCoverage: i / 15, security: i / 15 } as any);
    }

    const evolution = scorer.getEvolution(id);
    expect(evolution!.length).toBe(10);
  });

  it('should get all scores', async () => {
    await scorer.calc('s1', { testCoverage: 0.8, security: 0.8 } as any);
    await scorer.calc('s2', { testCoverage: 0.7, security: 0.7 } as any);
    
    const all = scorer.getAll();
    expect(all.length).toBe(2);
    expect(all[0].codeId).toBeDefined();
    expect(all[0].overall).toBeDefined();
    expect(all[0].grade).toBeDefined();
  });

  it('should allow custom weights', () => {
    scorer.setWeights({
      testCoverage: 0.4,
      security: 0.3,
      complexity: 0.1,
      documentation: 0.1,
      performance: 0.1,
    });

    // Should not throw (weights sum to 1)
    expect(() => scorer.setWeights({ testCoverage: 0.5 })).toThrow();
  });

  it('should calculate statistics', async () => {
    await scorer.calc('stat1', { testCoverage: 0.9, security: 0.9, complexity: 0.5, documentation: 0.8, performance: 0.8 }); // A - passed
    await scorer.calc('stat2', { testCoverage: 0.5, security: 0.6, complexity: 0.5, documentation: 0.5, performance: 0.5 }); // D - warning
    await scorer.calc('stat3', { testCoverage: 0.3, security: 0.3 } as any); // F - blocked

    const stats = scorer.stats();
    expect(stats.avg).toBeGreaterThan(0);
    expect(stats.passing).toBe(1);
    expect(stats.blocked).toBe(1);
  });

  it('should handle empty stats', () => {
    const stats = scorer.stats();
    expect(stats.avg).toBe(0);
    expect(stats.passing).toBe(0);
    expect(stats.blocked).toBe(0);
  });

  it('should clamp factor values to 1.0', async () => {
    const score = await scorer.calc('clamp', {
      testCoverage: 1.5, // > 1.0
      security: 0.9,
      complexity: 0.5,
      documentation: 0.7,
      performance: 0.8,
    } as any);

    expect(score.factors.testCoverage).toBe(1);
  });

  it('should emit score events', async () => {
    const events: Array<{ codeId: string; overall: number }> = [];
    scorer.on('score:calculated', (data) => {
      events.push(data);
    });

    await scorer.calc('event-test', { testCoverage: 0.8, security: 0.8 } as any);
    
    expect(events.length).toBe(1);
    expect(events[0].codeId).toBe('event-test');
  });
});
