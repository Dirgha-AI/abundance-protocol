/**
 * Maturity Scoring Demo - Multi-factor scoring test
 * Run: npx tsx tests/maturity-demo.ts
 */
import MaturityScorer from '../src/code-registry/maturity.js';

async function runDemo() {
  console.log('=== MATURITY SCORING DEMO ===\n');
  
  const scorer = new MaturityScorer();
  
  // Test cases with varying quality
  const testCases = [
    { id: 'code-a', metrics: { testCoverage: 0.9, documentation: 0.8, security: 0.9, complexity: 0.7, performance: 0.85 } },
    { id: 'code-b', metrics: { testCoverage: 0.3, documentation: 0.2, security: 0.5, complexity: 0.9, performance: 0.6 } },
    { id: 'code-c', metrics: { testCoverage: 0.6, documentation: 0.7, security: 0.4, complexity: 0.6, performance: 0.7 } },
  ];
  
  console.log('SCORING RESULTS:');
  for (const tc of testCases) {
    const score = await scorer.calc(tc.id, tc.metrics);
    const reg = scorer.canRegister(tc.id) ? 'CAN REGISTER' : 'BLOCKED';
    
    console.log(`\n  ${tc.id}:`);
    console.log(`    Score: ${score.overall.toFixed(3)} (Grade ${score.grade})`);
    console.log(`    Gating: ${score.gating.toUpperCase()} → ${reg}`);
    console.log(`    Recommendations: ${score.recommendations.join(', ') || 'None'}`);
  }
  
  console.log('\n📊 ALL SCORES:');
  console.log(scorer.getAll());
  
  console.log('\n📈 EVOLUTION (code-a):');
  console.log(scorer.getEvolution('code-a'));
  
  console.log('\n📊 SYSTEM STATS:');
  console.log(scorer.stats());
  
  console.log('\n✅ MATURITY DEMO: Multi-factor scoring working');
}

runDemo().catch(console.error);
