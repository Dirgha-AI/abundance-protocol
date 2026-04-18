import type { FunctionNode, ClassNode, CodeParser } from './parser.js';

export interface CodeChunk {
  id: string;
  content: string;
  language: string;
  type: 'function' | 'class' | 'module' | 'other';
  name?: string;
  startLine: number;
  endLine: number;
  tokenEstimate: number;
}

export class SemanticChunker {
  constructor(private parser: CodeParser) {}

  chunk(code: string, language: string, maxTokens = 500): CodeChunk[] {
    const chunks: CodeChunk[] = [], counter = { n: 0 }, covered = new Set<number>();

    const addChunk = (content: string, start: number, end: number, type: CodeChunk['type'], name?: string) => {
      const tokens = Math.ceil(content.length / 4);
      if (tokens > maxTokens) {
        chunks.push(...this.splitByLines(content, start, language, type, name, maxTokens, counter));
      } else {
        chunks.push({ id: `chunk-${language}-${counter.n++}`, content, language, type, name, startLine: start, endLine: end, tokenEstimate: tokens });
      }
    };

    const functions: FunctionNode[] = this.parser.extractFunctions(code, language);
    for (const fn of functions) {
      addChunk(fn.body, fn.startLine, fn.endLine, 'function', fn.name);
      for (let i = fn.startLine; i <= fn.endLine; i++) covered.add(i);
    }

    const classes: ClassNode[] = this.parser.extractClasses(code, language);
    for (const cls of classes) {
      // Avoid re-chunking lines already covered by individual functions
      const uncoveredLines = [];
      const clsLines = code.split('\n').slice(cls.startLine - 1, cls.endLine);
      const clsContent = clsLines.join('\n');
      addChunk(clsContent, cls.startLine, cls.endLine, 'class', cls.name);
      for (let i = cls.startLine; i <= cls.endLine; i++) covered.add(i);
    }

    const lines = code.split('\n');
    let curStart = 0, curLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!covered.has(i + 1)) {
        if (!curLines.length) curStart = i + 1;
        curLines.push(lines[i]);
      } else if (curLines.length) {
        addChunk(curLines.join('\n'), curStart, i, 'module');
        curLines = [];
      }
    }
    if (curLines.length) addChunk(curLines.join('\n'), curStart, lines.length, 'module');

    return chunks;
  }

  buildDependencyGraph(chunks: CodeChunk[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(['"]([^'"]+)['"]\)/g;

    for (const chunk of chunks) {
      const deps: string[] = [];
      let m: RegExpExecArray | null;
      importRegex.lastIndex = 0;
      requireRegex.lastIndex = 0;
      while ((m = importRegex.exec(chunk.content)) !== null) deps.push(m[1]);
      while ((m = requireRegex.exec(chunk.content)) !== null) deps.push(m[1]);
      if (deps.length) graph.set(chunk.id, [...new Set(deps)]);
    }
    return graph;
  }

  private splitByLines(content: string, startLine: number, language: string, type: CodeChunk['type'], name: string | undefined, maxTokens: number, counter: { n: number }): CodeChunk[] {
    const lines = content.split('\n');
    const avgLineLength = content.length / lines.length || 1;
    const linesPerChunk = Math.max(5, Math.floor(maxTokens * 4 / avgLineLength));
    const result: CodeChunk[] = [];

    for (let i = 0; i < lines.length; i += linesPerChunk) {
      const chunkLines = lines.slice(i, i + linesPerChunk);
      const chunkContent = chunkLines.join('\n');
      const partNum = Math.floor(i / linesPerChunk) + 1;
      result.push({
        id: `chunk-${language}-${counter.n++}`,
        content: chunkContent,
        language,
        type,
        name: name ? `${name}_part${partNum}` : undefined,
        startLine: startLine + i,
        endLine: startLine + i + chunkLines.length - 1,
        tokenEstimate: Math.ceil(chunkContent.length / 4)
      });
    }
    return result;
  }
}

export default SemanticChunker;
