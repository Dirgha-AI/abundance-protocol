export interface SimulationResult {
  nodeCount: number;
  totalRequests: number;
  successRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  durationMs: number;
  errors: string[];
}

const TASK_TYPES = ['compute_cpu', 'compute_gpu', 'ml_training', 'ml_inference', 'code_review', 'agent_execution'];

export function calcPercentile(times: number[], p: number): number {
  if (!times.length) return 0;
  const s = [...times].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
}

async function runNode(baseUrl: string, times: number[], errors: string[], counters: { sent: number; ok: number }) {
  const t0 = Date.now();
  let ok = 0;
  try {
    const body = JSON.stringify({ type: TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)], description: 'sim', requirements: {}, budget: 1 });
    counters.sent++;
    const r1 = await fetch(`${baseUrl}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!r1.ok) throw new Error(`POST ${r1.status}`);
    ok++;
    counters.sent++;
    const r2 = await fetch(`${baseUrl}/tasks`);
    if (!r2.ok) throw new Error(`GET ${r2.status}`);
    ok++;
    counters.sent++;
    const r3 = await fetch(`${baseUrl}/health`);
    if (!r3.ok) throw new Error(`HEALTH ${r3.status}`);
    ok++;
    times.push(Date.now() - t0);
  } catch (e) {
    errors.push(String(e));
  }
  counters.ok += ok;
}

export async function simulateNodes(count: number, baseUrl: string): Promise<SimulationResult> {
  const t0 = Date.now();
  const times: number[] = [];
  const errors: string[] = [];
  const counters = { sent: 0, ok: 0 };
  const batch = 20;
  for (let i = 0; i < count; i += batch) {
    const chunk = Array(Math.min(batch, count - i)).fill(0).map(() => runNode(baseUrl, times, errors, counters));
    await Promise.all(chunk);
  }
  return {
    nodeCount: count,
    totalRequests: counters.sent,
    successRate: counters.sent ? (counters.ok / counters.sent) * 100 : 0,
    p50Ms: calcPercentile(times, 50),
    p95Ms: calcPercentile(times, 95),
    p99Ms: calcPercentile(times, 99),
    durationMs: Date.now() - t0,
    errors: errors.slice(0, 50)
  };
}
