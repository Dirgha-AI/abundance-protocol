/**
 * MeshLLMProvider — distributed inference over the Bucky peer mesh.
 * Routes prompts to capable peers and aggregates results.
 * When an adapter is set, delegates to MeshLLMAdapter.routeInference();
 * otherwise falls back to a local Ollama call.
 */

import type { MeshLLMAdapter } from './adapter.js'
import type { InferenceJob } from './types.js'

export class MeshLLMProvider {
  private peers: string[] = [];
  private gpuIds: number[] = [];
  private adapter?: MeshLLMAdapter;

  setAdapter(adapter: MeshLLMAdapter): void {
    this.adapter = adapter;
  }

  async joinMesh(addrs: string[]): Promise<void> {
    this.peers = addrs;
    console.log('[MeshLLM] Joined mesh with', addrs.length, 'bootstrap peers');
  }

  async registerLocalExpert(gpuIds: number[]): Promise<void> {
    this.gpuIds = gpuIds;
    console.log('[MeshLLM] Registered as local expert with GPUs:', gpuIds);
  }

  async distributedChat(prompt: string, userId: string, model = 'llama3.2'): Promise<string> {
    if (this.adapter) {
      const job: InferenceJob = {
        id: crypto.randomUUID(),
        prompt,
        model,
        maxTokens: 2048,
        temperature: 0.7,
        userId,
        priority: 'normal',
        requireVerification: false,
      };
      const result = await this.adapter.routeInference(job);
      return result.content;
    }

    // Fallback: call local Ollama directly
    try {
      const r = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: AbortSignal.timeout(60_000),
      });
      const d = await r.json();
      return d.response || '[No response from local model]';
    } catch {
      return `[MeshLLM] No peers available and local Ollama not running. Start Ollama or join a mesh with dirgha mesh join`;
    }
  }
}
