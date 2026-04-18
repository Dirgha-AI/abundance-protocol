// eslint-disable-next-line @typescript-eslint/no-require-imports
const Parser = require('tree-sitter') as typeof import('tree-sitter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JavaScript = require('tree-sitter-javascript') as any;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { typescript } = require('tree-sitter-typescript') as { typescript: any };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Python = require('tree-sitter-python') as any;

export interface ASTNode { type: string; startLine: number; endLine: number; text?: string; children?: ASTNode[] }
export interface ParsedAST { language: string; nodes: ASTNode[]; raw: string }
export interface FunctionNode { name: string; startLine: number; endLine: number; body: string; params: string[] }
export interface ClassNode { name: string; startLine: number; endLine: number; methods: FunctionNode[] }

export class CodeParser {
  private parsers = new Map<string, any>();
  private getParser(lang: string) {
    if (!this.parsers.has(lang)) {
      const p = new Parser();
      if (lang === 'javascript') p.setLanguage(JavaScript);
      else if (lang === 'typescript') p.setLanguage(typescript);
      else if (lang === 'python') p.setLanguage(Python);
      else return null;
      this.parsers.set(lang, p);
    }
    return this.parsers.get(lang);
  }

  detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', go: 'go', rs: 'rust', java: 'java' };
    return (ext && map[ext]) || 'unknown';
  }

  parse(code: string, language: string): ParsedAST {
    try {
      const parser = this.getParser(language);
      if (!parser) return { language, nodes: [], raw: code };
      const tree = parser.parse(code);
      const nodes: ASTNode[] = [];
      const walk = (node: any) => {
        nodes.push({ type: node.type, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, text: code.slice(node.startIndex, node.endIndex) });
        node.children.forEach(walk);
      };
      walk(tree.rootNode);
      return { language, nodes, raw: code };
    } catch {
      return { language, nodes: [], raw: code };
    }
  }

  extractFunctions(code: string, language: string): FunctionNode[] {
    const funcs: FunctionNode[] = [];
    try {
      const parser = this.getParser(language);
      if (parser) {
        const tree = parser.parse(code);
        const walk = (node: any) => {
          const types = language === 'python' ? ['function_definition'] : ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'];
          if (types.includes(node.type)) {
            const name = node.childForFieldName?.('name')?.text || 'anonymous';
            const params = node.childForFieldName?.('parameters')?.text?.slice(1, -1).split(',').map((p: string) => p.trim()).filter(Boolean) || [];
            funcs.push({ name, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, body: code.slice(node.startIndex, node.endIndex), params });
          }
          node.children.forEach(walk);
        };
        walk(tree.rootNode);
        return funcs;
      }
    } catch {}
    const patterns: Record<string, RegExp> = {
      typescript: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm,
      javascript: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm,
      python: /def\s+(\w+)\s*\(([^)]*)\)/gm,
      go: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/gm,
      rust: /(?:pub\s+)?fn\s+(\w+)\s*[<(]/gm,
      java: /(?:public|private|protected|static).*?\s+(\w+)\s*\(/gm
    };
    const regex = patterns[language];
    if (regex) {
      let m: RegExpExecArray | null;
      while ((m = regex.exec(code)) !== null) {
        const lines = code.slice(0, m.index).split('\n');
        const startLine = lines.length;
        const endLine = startLine + (m[0].match(/\n/g)?.length || 0);
        funcs.push({ name: m[1], startLine, endLine, body: m[0], params: m[2]?.split(',').map((p: string) => p.trim()).filter(Boolean) || [] });
      }
    }
    return funcs;
  }

  extractClasses(code: string, language: string): ClassNode[] {
    const classes: ClassNode[] = [];
    try {
      const parser = this.getParser(language);
      if (parser) {
        const tree = parser.parse(code);
        const walk = (node: any) => {
          const types = language === 'python' ? ['class_definition'] : ['class_declaration', 'class_expression'];
          if (types.includes(node.type)) {
            const name = node.childForFieldName?.('name')?.text || 'anonymous';
            const methods: FunctionNode[] = [];
            node.children.forEach((child: any) => {
              if (['method_definition', 'function_definition'].includes(child.type)) {
                const mname = child.childForFieldName?.('name')?.text || 'anonymous';
                const params = child.childForFieldName?.('parameters')?.text?.slice(1, -1).split(',').map((p: string) => p.trim()).filter(Boolean) || [];
                methods.push({ name: mname, startLine: child.startPosition.row + 1, endLine: child.endPosition.row + 1, body: code.slice(child.startIndex, child.endIndex), params });
              }
            });
            classes.push({ name, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, methods });
          }
          node.children.forEach(walk);
        };
        walk(tree.rootNode);
        return classes;
      }
    } catch {}
    const regex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(code)) !== null) {
      const lines = code.slice(0, m.index).split('\n');
      const startLine = lines.length;
      const endLine = startLine + (m[0].match(/\n/g)?.length || 0);
      classes.push({ name: m[1], startLine, endLine, methods: [] });
    }
    return classes;
  }
}

export default CodeParser;
