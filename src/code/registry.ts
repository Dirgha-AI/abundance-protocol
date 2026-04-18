import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import type { CodeParser } from './parser.js'
import type { SemanticChunker, CodeChunk } from './chunker.js'

export interface CodeBlock {
  id: string; hash: string; language: string; content: string; chunks: CodeChunk[];
  metadata?: Record<string, string>; createdAt: Date; ast?: string; source?: string; dependencies?: string[];
}

export class CodeRegistry extends EventEmitter {
  private blocks = new Map<string, CodeBlock>();
  private parser: CodeParser | null;
  private chunker: SemanticChunker | null;

  constructor(parser?: CodeParser, chunker?: SemanticChunker) {
    super();
    this.parser = parser ?? null;
    this.chunker = chunker ?? null;
  }

  register(code: string, language: string, metadata?: Record<string, string>): CodeBlock {
    const hash = this.computeHash(code);
    const existing = this.findByHash(hash);
    if (existing) return existing;
    let chunks: CodeChunk[];
    if (this.chunker) {
      chunks = this.chunker.chunk(code, language);
    } else {
      const lines = code.split('\n');
      chunks = [{ id: `chunk-${Date.now()}`, content: code, language, type: 'module', startLine: 1, endLine: lines.length, tokenEstimate: Math.ceil(code.length / 4) }];
    }
    const block: CodeBlock = {
      id: `block-${Date.now()}`, hash, language, content: code, chunks, metadata, createdAt: new Date(),
      ast: JSON.stringify({ type: 'Program', body: [] }), source: code, dependencies: this.extractImports(code)
    };
    this.blocks.set(block.id, block);
    this.emit('block:registered', block);
    return block;
  }

  findById(id: string): CodeBlock | undefined { return this.blocks.get(id); }
  findByHash(hash: string): CodeBlock | undefined { for (const b of this.blocks.values()) if (b.hash === hash) return b; return undefined; }

  search(query: string): CodeBlock[] {
    const q = query.toLowerCase();
    return Array.from(this.blocks.values()).filter(b => b.content.toLowerCase().includes(q) || (b.metadata && Object.values(b.metadata).some(v => v.toLowerCase().includes(q))));
  }

  findSimilar(code: string, language: string, topK = 5): Array<{ block: CodeBlock; score: number }> {
    const qv = this.computeTfIdf(code);
    const res: Array<{ block: CodeBlock; score: number }> = [];
    for (const b of this.blocks.values()) {
      if (b.language !== language) continue;
      res.push({ block: b, score: this.cosineSimilarity(qv, this.computeTfIdf(b.content)) });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  list(): CodeBlock[] { return Array.from(this.blocks.values()); }
  getBlock(id: string): CodeBlock | undefined { return this.findById(id); }
  getAllBlocks(): CodeBlock[] { return this.list(); }

  stats(): { totalBlocks: number; totalChunks: number; languages: Record<string, number> } {
    const langs: Record<string, number> = {};
    let chunks = 0;
    for (const b of this.blocks.values()) { langs[b.language] = (langs[b.language] || 0) + 1; chunks += b.chunks.length; }
    return { totalBlocks: this.blocks.size, totalChunks: chunks, languages: langs };
  }

  computeHash(content: string): string { return createHash('sha256').update(content.trim()).digest('hex'); }

  private extractImports(code: string): string[] {
    const m: string[] = [];
    const r = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    let x;
    while ((x = r.exec(code)) !== null) m.push(x[1] || x[2]);
    return m;
  }

  private computeTfIdf(text: string): Map<string, number> {
    const t = text.toLowerCase().split(/\W+/).filter(Boolean);
    const tf = new Map<string, number>();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    const n = t.length;
    for (const [k, v] of tf) tf.set(k, v / n);
    return tf;
  }

  private cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    if (!a.size || !b.size) return 0;
    let d = 0, na = 0, nb = 0;
    for (const [k, v] of a) { if (b.has(k)) d += v * b.get(k)!; na += v * v; }
    for (const v of b.values()) nb += v * v;
    return d / (Math.sqrt(na) * Math.sqrt(nb));
  }
}

export const codeRegistry = new CodeRegistry();
export default CodeRegistry;
