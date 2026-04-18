// Code block registry with AST-based deduplication
// Sprint 14: Foundation for distributed code sharing

import { EventEmitter } from 'events';
import { createHash } from 'crypto';

export interface CodeBlock {
  id: string;
  hash: string;
  ast: string;
  source: string;
  language: string;
  dependencies: string[];
  createdAt: Date;
}

export class CodeRegistry extends EventEmitter {
  private blocks = new Map<string, CodeBlock>();

  async register(code: string, language: string): Promise<CodeBlock> {
    // Compute AST hash (simplified - real would use tree-sitter)
    const hash = this.computeHash(code);

    // Check for duplicates
    const existing = this.findByHash(hash);
    if (existing) {
      console.log(`[CodeRegistry] Duplicate found: ${existing.id}`);
      return existing;
    }

    const block: CodeBlock = {
      id: `block-${Date.now()}`,
      hash,
      ast: this.parseAST(code),
      source: code,
      language,
      dependencies: this.extractImports(code),
      createdAt: new Date()
    };

    this.blocks.set(block.id, block);
    this.emit('block:registered', block);
    return block;
  }

  private computeHash(code: string): string {
    return createHash('sha256').update(code.trim()).digest('hex');
  }

  private parseAST(code: string): string {
    // Real: tree-sitter parse
    return JSON.stringify({ type: 'Program', body: [] });
  }

  private extractImports(code: string): string[] {
    const imports: string[] = [];
    const regex = /import\s+.*?\s+from\s+['"]([^'"]+)['"];?/g;
    let match;
    while ((match = regex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }

  private findByHash(hash: string): CodeBlock | undefined {
    for (const block of this.blocks.values()) {
      if (block.hash === hash) return block;
    }
    return undefined;
  }

  getBlock(id: string): CodeBlock | undefined {
    return this.blocks.get(id);
  }

  getAllBlocks(): CodeBlock[] {
    return Array.from(this.blocks.values());
  }

  search(query: string): CodeBlock[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.blocks.values()).filter(block =>
      block.source.toLowerCase().includes(lowerQuery)
    );
  }
}

export const codeRegistry = new CodeRegistry();
export default CodeRegistry;
