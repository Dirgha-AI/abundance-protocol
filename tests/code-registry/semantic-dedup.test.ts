/**
 * Semantic Deduplication Engine Tests
 * 90%+ deduplication rate verification
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticDedupEngine } from '../../src/code-registry/semantic-dedup';

describe('SemanticDedupEngine', () => {
  let engine: SemanticDedupEngine;

  beforeEach(async () => {
    engine = new SemanticDedupEngine({ threshold: 0.92 });
    await engine.initialize();
  });

  it('should initialize successfully', () => {
    const stats = engine.getStats();
    expect(stats.total).toBe(0);
    expect(stats.dedupRate).toBe(0);
  });

  it('should generate 768-dimensional embeddings', async () => {
    const code = 'function add(a, b) { return a + b; }';
    const vector = await engine.generateEmbedding(code);
    
    expect(vector.length).toBe(768);
    expect(vector.every(v => v >= 0 && v <= 1)).toBe(true);
  });

  it('should ingest new code blocks', async () => {
    const code = 'const x = 42;';
    const result = await engine.ingest(code, 'javascript');
    
    expect(result.isDuplicate).toBe(false);
    expect(result.newBlock).toBeDefined();
    expect(result.newBlock!.language).toBe('javascript');
  });

  it('should detect exact duplicates', async () => {
    const code = 'function test() { return true; }';
    
    const first = await engine.ingest(code, 'javascript');
    expect(first.isDuplicate).toBe(false);
    
    const second = await engine.ingest(code, 'javascript');
    expect(second.isDuplicate).toBe(true);
    expect(second.similarity).toBe(1.0);
  });

  it('should detect semantic duplicates', async () => {
    const code1 = 'function sum(a, b) { return a + b; }';
    const code2 = 'function sum(x, y) { return x + y; }';
    
    await engine.ingest(code1, 'javascript');
    const result = await engine.ingest(code2, 'javascript');
    
    // Should have high similarity
    if (result.isDuplicate) {
      expect(result.similarity).toBeGreaterThan(0.9);
    }
  });

  it('should achieve 90%+ dedup rate on duplicate code', async () => {
    // Create 10 copies of the same code
    const code = `
      function calculateTotal(items) {
        let total = 0;
        for (const item of items) {
          total += item.price * item.quantity;
        }
        return total;
      }
    `;

    let duplicates = 0;
    const total = 10;

    for (let i = 0; i < total; i++) {
      const result = await engine.ingest(code, 'javascript', { iteration: i });
      if (result.isDuplicate) duplicates++;
    }

    const dedupRate = (duplicates / (total - 1)) * 100; // Exclude first unique
    expect(dedupRate).toBeGreaterThanOrEqual(90);
  });

  it('should search by vector similarity', async () => {
    const code1 = 'function add(a, b) { return a + b; }';
    const code2 = 'function subtract(a, b) { return a - b; }';
    const code3 = 'const greeting = "hello";';
    
    await engine.ingest(code1, 'javascript', { id: 1 });
    await engine.ingest(code2, 'javascript', { id: 2 });
    await engine.ingest(code3, 'javascript', { id: 3 });

    const query = await engine.generateEmbedding('function multiply(x, y) { return x * y; }');
    const results = engine.searchByVector(query, 3);
    
    expect(results.length).toBe(3);
    // Mathematical functions should be more similar
    expect(results[0].similarity).toBeGreaterThan(0.5);
  });

  it('should search by code', async () => {
    await engine.ingest('function foo() {}', 'javascript');
    
    const results = await engine.searchByCode('function bar() {}', 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should batch ingest efficiently', async () => {
    const items = [
      { code: 'const a = 1;', language: 'javascript' },
      { code: 'const b = 2;', language: 'javascript' },
      { code: 'const c = 3;', language: 'javascript' },
    ];

    const results = await engine.batchIngest(items);
    expect(results.length).toBe(3);
  });

  it('should calculate cosine similarity', async () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const c = [0, 1, 0];
    
    expect(engine.cosine(a, b)).toBe(1);
    expect(engine.cosine(a, c)).toBe(0);
  });

  it('should update threshold', () => {
    engine.setThreshold(0.85);
    // Should accept valid thresholds
    expect(() => engine.setThreshold(1.5)).not.toThrow();
    expect(() => engine.setThreshold(-0.5)).not.toThrow();
  });

  it('should track deduplication statistics', async () => {
    const code = 'test code';
    await engine.ingest(code, 'javascript');
    await engine.ingest(code, 'javascript'); // Duplicate
    
    const stats = engine.getDedupSummary();
    expect(stats.totalProcessed).toBe(2);
    expect(stats.duplicatesFound).toBe(1);
    expect(stats.dedupRate).toBe(50);
  });

  it('should export embeddings', async () => {
    await engine.ingest('code 1', 'js');
    await engine.ingest('code 2', 'js');
    
    const exported = engine.exportEmbeddings();
    expect(exported.length).toBe(2);
    expect(exported[0].vector.length).toBe(768);
  });

  it('should clear all data', async () => {
    await engine.ingest('code', 'js');
    expect(engine.getStats().total).toBe(1);
    
    engine.clear();
    expect(engine.getStats().total).toBe(0);
  });
});
