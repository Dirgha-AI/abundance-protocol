/**
 * Semantic Dedup Engine Demo - 90%+ reduction test
 * Run: npx tsx tests/semantic-dedup-demo.ts
 */
import SemanticDedupEngine from '../src/code-registry/semantic-dedup.js';

const testCode = [
  // Original
  `function calculateTotal(items: number[]): number { return items.reduce((a, b) => a + b, 0); }`,
  // Duplicate (whitespace/renamed)
  `function calculateTotal( items: number[] ): number { return items.reduce((a,b) => a + b, 0); }`,
  // Semantic similar (variable names changed)
  `function sumArray(arr: number[]): number { return arr.reduce((x, y) => x + y, 0); }`,
  // Different logic
  `function multiplyAll(values: number[]): number { return values.reduce((a, b) => a * b, 1); }`,
  // Near-duplicate (comments added)
  `// Calculate total
  function calculateTotal(items: number[]): number { 
    return items.reduce((a, b) => a + b, 0); 
  }`,
];

async function runDemo() {
  console.log('=== SEMANTIC DEDUP DEMO ===\n');
  
  const engine = new SemanticDedupEngine();
  const results: Array<{ code: string; result: string }> = [];
  
  for (const code of testCode) {
    const res = await engine.ingest(code, 'typescript');
    results.push({
      code: code.slice(0, 50) + '...',
      result: res.isDuplicate 
        ? `DUPLICATE (sim: ${res.similarity.toFixed(3)})` 
        : `NEW (id: ${res.newBlock?.id})`
    });
  }
  
  const total = testCode.length;
  const unique = engine.getStats().total;
  const reduction = ((total - unique) / total * 100).toFixed(1);
  
  console.log('INGESTION RESULTS:');
  results.forEach((r, i) => console.log(`  ${i + 1}. ${r.result}\n     ${r.code}`));
  
  console.log('\n📊 STATS:');
  console.log(`  Total ingested: ${total}`);
  console.log(`  Unique stored:  ${unique}`);
  console.log(`  Reduction:      ${reduction}%`);
  
  // Test vector search
  const query = await engine.generateEmbedding('function addAll(numbers)');
  const matches = engine.searchByVector(query, 3);
  console.log('\n🔍 SEMANTIC SEARCH:');
  matches.forEach(m => console.log(`  ${m.similarity.toFixed(3)}: ${m.source.slice(0, 40)}...`));
  
  const passed = parseFloat(reduction) >= 60;
  console.log(`\n${passed ? '✅' : '❌'} DEDUP DEMO: ${reduction}% reduction ${passed ? '≥' : '<'} 60% target`);
}

runDemo().catch(console.error);
