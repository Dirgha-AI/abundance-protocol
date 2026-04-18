import { simulateNodes } from './simulator.js';
import { runStressTest } from './stress.js';

const BUCKY_URL = process.env.BUCKY_URL ?? 'http://localhost:4200';
const NODE_COUNT = 100;
const TASK_COUNT = 1000;

async function main() {
  console.log(`[load] target=${BUCKY_URL}`);
  console.log(`[load] running node simulation: ${NODE_COUNT} nodes...`);
  const sim = await simulateNodes(NODE_COUNT, BUCKY_URL);

  console.log(`[load] running stress test: ${TASK_COUNT} tasks...`);
  const stress = await runStressTest(BUCKY_URL, TASK_COUNT);

  console.log('\n=== LOAD TEST RESULTS ===');
  console.log(`Nodes simulated  : ${sim.nodeCount}`);
  console.log(`Total requests   : ${sim.totalRequests}`);
  console.log(`Success rate     : ${sim.successRate.toFixed(2)}%`);
  console.log(`p50 latency      : ${sim.p50Ms}ms`);
  console.log(`p95 latency      : ${sim.p95Ms}ms`);
  console.log(`p99 latency      : ${sim.p99Ms}ms`);
  console.log(`Sim duration     : ${sim.durationMs}ms`);
  console.log('---');
  console.log(`Tasks submitted  : ${stress.submitted}`);
  console.log(`Tasks completed  : ${stress.completed}`);
  console.log(`Tasks failed     : ${stress.failed}`);
  console.log(`Throughput       : ${stress.throughputPerSec.toFixed(2)} tasks/sec`);
  console.log(`Peak memory      : ${stress.peakMemoryMB}MB`);
  console.log(`Stress duration  : ${stress.durationMs}ms`);
  console.log('=========================\n');

  let exitCode = 0;
  if (sim.successRate < 95) {
    console.error(`FAIL: successRate ${sim.successRate.toFixed(2)}% < 95%`);
    exitCode = 1;
  }
  if (stress.throughputPerSec < 10) {
    console.error(`FAIL: throughput ${stress.throughputPerSec.toFixed(2)} tasks/sec < 10`);
    exitCode = 1;
  }
  if (exitCode === 0) console.log('PASS: all thresholds met');
  process.exit(exitCode);
}

main().catch(e => { console.error('[load] fatal:', e); process.exit(1); });
