export interface StressResult {
  submitted: number;
  completed: number;
  failed: number;
  throughputPerSec: number;
  peakMemoryMB: number;
  durationMs: number;
}

const types = ['compute_cpu', 'compute_gpu', 'ml_training', 'ml_inference', 'code_review', 'agent_execution'];

function memMB() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

export async function runStressTest(baseUrl: string, taskCount: number): Promise<StressResult> {
  const start = Date.now();
  let peak = memMB();
  const ids: string[] = [];
  const batch = 50;

  for (let i = 0; i < taskCount; i += batch) {
    const chunk = [];
    for (let j = i; j < Math.min(i + batch, taskCount); j++) {
      chunk.push(fetch(`${baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: types[j % 6] })
      }).then(r => r.json()).then(d => d.taskId));
    }
    ids.push(...await Promise.all(chunk));
    peak = Math.max(peak, memMB());
  }

  const completed = new Set<string>();
  const failed = new Set<string>();

  await Promise.all(ids.map(async id => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/tasks`);
        const tasks = await res.json();
        const t = tasks.find((x: any) => x.taskId === id);
        if (t?.status === 'completed') { completed.add(id); return; }
        if (t?.status === 'failed') { failed.add(id); return; }
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
  }));

  const duration = Date.now() - start;
  peak = Math.max(peak, memMB());

  return {
    submitted: ids.length,
    completed: completed.size,
    failed: ids.length - completed.size,
    throughputPerSec: completed.size / (duration / 1000),
    peakMemoryMB: Math.round(peak * 100) / 100,
    durationMs: duration
  };
}
