declare module 'tree-sitter' {
  class Parser {
    setLanguage(language: unknown): void;
    parse(source: string): { rootNode: unknown };
  }
  namespace Parser {}
  export = Parser;
}
declare module 'tree-sitter-javascript' {
  const language: unknown;
  export = language;
}
declare module 'tree-sitter-typescript' {
  const language: unknown;
  export = language;
}
declare module 'tree-sitter-python' {
  const language: unknown;
  export = language;
}
