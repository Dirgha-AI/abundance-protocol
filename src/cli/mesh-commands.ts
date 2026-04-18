import { Command } from "commander";

const BASE = `http://localhost:${process.env.BUCKY_PORT ?? "4200"}`;

export function registerMeshCommands(program: Command): void {
  const mesh = program.command("mesh");

  mesh
    .command("join")
    .option("-p, --peers <peers>", "comma-separated peer addresses")
    .action(async () => {
      await fetch(`${BASE}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "agent_execution", description: "mesh join probe" }),
      });
      const res = await fetch(`${BASE}/health`);
      const health = (await res.json()) as { peers: string[] };
      console.log(`Joined mesh. Peer count: ${health.peers?.length ?? 0}`);
    });

  mesh
    .command("run")
    .argument("<description>", "task description")
    .option("--budget <n>", "compute budget", "1000")
    .action(async (description: string, opts: { budget: string }) => {
      const res = await fetch(`${BASE}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          type: "agent_execution",
          budget: Number(opts.budget),
        }),
      });
      const data = (await res.json()) as { taskId: string; status: string };
      console.log(`taskId: ${data.taskId}  status: ${data.status}`);
    });

  mesh.command("status").action(async () => {
    const [health, peers] = await Promise.all([
      fetch(`${BASE}/health`).then((r) => r.json()) as Promise<{
        status: string;
        nodeId: string;
        peers: string[];
        uptime: number;
      }>,
      fetch(`${BASE}/mesh/peers`).then((r) => r.json()) as Promise<{
        peers: string[];
      }>,
    ]);
    console.log(`nodeId : ${health.nodeId}`);
    console.log(`status : ${health.status}`);
    console.log(`uptime : ${health.uptime}s`);
    console.log(`peers  : ${peers.peers?.length ?? 0}`);
  });
}
