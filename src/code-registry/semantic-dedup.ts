/**
 * Semantic Dedup Engine v3.0 - Production Implementation
 * 768-dimensional vector embeddings with @xenova/transformers
 */
import { createHash, randomUUID } from 'crypto';
import { EventEmitter } from 'events';

export interface CodeEmbedding {
  id: string;
  codeHash: string;
  vector: number[];
  source: string;
  language: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface DedupResult {
  isDuplicate: boolean;
  originalId?: string;
  similarity: number;
  newBlock?: CodeEmbedding;
}

export interface SimilarityMatch {
  id: string;
  similarity: number;
  source: string;
  language: string;
}

export class SemanticDedupEngine extends EventEmitter {
  private embeddings = new Map<string, CodeEmbedding>();
  private codeToId = new Map<string, string>();
  private THRESHOLD = 0.92;
  private DIMENSION = 768;
  private embeddingModel: any = null;
  private modelLoaded = false;
  private dedupStats = { total: 0, duplicates: 0, saved: 0 };

  constructor(options: { threshold?: number } = {}) {
    super();
    if (options.threshold) this.THRESHOLD = options.threshold;
  }

  /**
   * Initialize with real transformer embeddings (lazy load)
   * Falls back to hash-based embeddings if transformers unavailable
   */
  async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid breaking if package not installed
      // @ts-ignore - optional dependency, falls back if not installed
      const transformers = await import('@xenova/transformers').catch(() => null);
      if (transformers) {
        const { pipeline } = transformers;
        this.embeddingModel = await pipeline('feature-extraction', 'Xenova/codebert-base');
        this.modelLoaded = true;
        this.emit('model:loaded', { type: 'real', dim: this.DIMENSION });
      } else {
        this.emit('model:loaded', { type: 'fallback', dim: this.DIMENSION });
      }
    } catch (err) {
      this.emit('model:error', { error: err });
      this.modelLoaded = false;
    }
  }

  /**
   * Generate 768-dimensional embedding from code
   * Uses real model if available, falls back to hash-based
   */
  async generateEmbedding(code: string): Promise<number[]> {
    if (this.modelLoaded && this.embeddingModel) {
      try {
        const output = await this.embeddingModel(code, {
          pooling: 'mean',
          normalize: true,
        });
        const vector = Array.from(output.data) as number[];
        // Pad or truncate to exactly 768 dimensions
        if (vector.length < this.DIMENSION) {
          return [...vector, ...new Array(this.DIMENSION - vector.length).fill(0)];
        }
        return vector.slice(0, this.DIMENSION);
      } catch (err) {
        this.emit('embedding:error', { error: err });
      }
    }
    
    // Fallback: deterministic hash-based embedding
    return this.generateHashEmbedding(code);
  }

  /**
   * Generate deterministic hash-based embedding (fallback)
   */
  private generateHashEmbedding(code: string): number[] {
    const normalized = code
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // Remove comments
    
    const hash = createHash('sha256').update(normalized).digest('hex');
    const vector: number[] = [];
    
    for (let i = 0; i < this.DIMENSION; i++) {
      const idx = (i * 2) % hash.length;
      const val = parseInt(hash.slice(idx, idx + 2), 16) / 255;
      // Add some code structure variance
      const positionFactor = Math.sin(i * 0.1) * 0.1;
      vector.push(Math.min(1, Math.max(0, val + positionFactor)));
    }
    
    return vector;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosine(a: number[], b: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }
    
    const mag = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return mag === 0 ? 0 : dotProduct / mag;
  }

  /**
   * Ingest code block with incremental deduplication
   */
  async ingest(
    code: string,
    language: string,
    metadata?: Record<string, unknown>
  ): Promise<DedupResult> {
    this.dedupStats.total++;
    
    // Exact hash match first (fast path)
    const codeHash = createHash('sha256').update(code).digest('hex');
    if (this.codeToId.has(codeHash)) {
      this.dedupStats.duplicates++;
      this.dedupStats.saved += code.length;
      return {
        isDuplicate: true,
        originalId: this.codeToId.get(codeHash),
        similarity: 1.0,
      };
    }

    // Generate semantic embedding
    const vector = await this.generateEmbedding(code);
    
    // Semantic similarity search
    const similar = this.findSimilar(vector, this.THRESHOLD);
    if (similar) {
      this.dedupStats.duplicates++;
      this.dedupStats.saved += code.length;
      this.emit('duplicate:found', {
        newId: similar.id,
        similarity: similar.sim,
        language,
      });
      return {
        isDuplicate: true,
        originalId: similar.id,
        similarity: similar.sim,
      };
    }

    // New unique block
    const block: CodeEmbedding = {
      id: `emb-${randomUUID().slice(0, 8)}`,
      codeHash,
      vector,
      source: code,
      language,
      metadata: metadata || {},
      createdAt: new Date(),
    };

    this.embeddings.set(block.id, block);
    this.codeToId.set(codeHash, block.id);
    
    this.emit('block:ingested', {
      id: block.id,
      language,
      size: code.length,
      dim: vector.length,
    });

    return {
      isDuplicate: false,
      similarity: 0,
      newBlock: block,
    };
  }

  /**
   * Find most similar embedding above threshold
   */
  private findSimilar(v: number[], threshold: number): { id: string; sim: number } | null {
    let best: { id: string; sim: number } | null = null;
    
    for (const [id, emb] of this.embeddings) {
      const sim = this.cosine(v, emb.vector);
      if (sim >= threshold && (!best || sim > best.sim)) {
        best = { id, sim };
      }
    }
    
    return best;
  }

  /**
   * Search by vector similarity (top-k results)
   */
  searchByVector(query: number[], topK = 5): SimilarityMatch[] {
    const results: SimilarityMatch[] = [];
    
    for (const [id, emb] of this.embeddings) {
      results.push({
        id,
        similarity: this.cosine(query, emb.vector),
        source: emb.source.slice(0, 100),
        language: emb.language,
      });
    }
    
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Search by code similarity (convenience method)
   */
  async searchByCode(code: string, topK = 5): Promise<SimilarityMatch[]> {
    const vector = await this.generateEmbedding(code);
    return this.searchByVector(vector, topK);
  }

  /**
   * Batch ingest for efficiency
   */
  async batchIngest(
    items: Array<{ code: string; language: string; metadata?: Record<string, unknown> }>
  ): Promise<DedupResult[]> {
    const results: DedupResult[] = [];
    for (const item of items) {
      results.push(await this.ingest(item.code, item.language, item.metadata));
    }
    return results;
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    total: number;
    dedupRatio: number;
    dedupRate: number;
    avgVectorSize: number;
    modelLoaded: boolean;
    bytesSaved: number;
  } {
    const total = this.embeddings.size;
    const dedupRatio = this.dedupStats.total > 0
      ? this.dedupStats.duplicates / this.dedupStats.total
      : 0;
    
    return {
      total,
      dedupRatio,
      dedupRate: dedupRatio * 100,
      avgVectorSize: this.DIMENSION * 4, // float32
      modelLoaded: this.modelLoaded,
      bytesSaved: this.dedupStats.saved,
    };
  }

  /**
   * Get deduplication summary
   */
  getDedupSummary(): {
    totalProcessed: number;
    uniqueBlocks: number;
    duplicatesFound: number;
    dedupRate: number;
    bytesSaved: number;
  } {
    return {
      totalProcessed: this.dedupStats.total,
      uniqueBlocks: this.embeddings.size,
      duplicatesFound: this.dedupStats.duplicates,
      dedupRate: this.dedupStats.total > 0
        ? (this.dedupStats.duplicates / this.dedupStats.total) * 100
        : 0,
      bytesSaved: this.dedupStats.saved,
    };
  }

  /**
   * Export all embeddings
   */
  exportEmbeddings(): CodeEmbedding[] {
    return Array.from(this.embeddings.values());
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.embeddings.clear();
    this.codeToId.clear();
    this.dedupStats = { total: 0, duplicates: 0, saved: 0 };
    this.emit('cleared');
  }

  /**
   * Update similarity threshold
   */
  setThreshold(threshold: number): void {
    this.THRESHOLD = Math.max(0, Math.min(1, threshold));
  }

  /**
   * Register a task output with quality score (used by handlers)
   */
  async register(description: string, output: string, workerId: string, score: number): Promise<void> {
    await this.ingest(`${description}\n${output}`, 'text', { workerId, score: String(score) });
  }

  /**
   * Look up a cached result by semantic similarity (used by handlers)
   */
  async lookup(intent: string): Promise<{ id: string } | null> {
    const results = await this.searchByCode(intent, 1);
    if (results.length > 0 && results[0].similarity >= this.THRESHOLD) {
      return { id: results[0].id };
    }
    return null;
  }
}

export default SemanticDedupEngine;
