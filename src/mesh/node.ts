import { createLibp2p, Libp2pOptions } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { gossipsub } from '@libp2p/gossipsub'
import { mdns } from '@libp2p/mdns'
import type { Libp2p } from 'libp2p'
import type { Message } from '@libp2p/gossipsub'
import { MeshConfig, MeshTask, ConsensusVote, PeerInfo } from '../types/index.js'

export class BuckyNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private node: any = null
  private config: MeshConfig
  private taskHandlers: Array<(task: MeshTask) => void> = []
  private voteHandlers: Array<(vote: ConsensusVote) => void> = []
  private peerHandlers: Array<(peer: PeerInfo) => void> = []

  constructor(config: MeshConfig) {
    this.config = config
    this.log('Initialized with config:', { nodeId: config.nodeId, port: config.listenPort })
  }

  private log(...args: unknown[]): void { console.log('[BuckyNode]', ...args) }
  private error(...args: unknown[]): void { console.error('[BuckyNode]', ...args) }

  async start(): Promise<void> {
    try {
      this.log('Starting node...')
      const options: Libp2pOptions = {
        transports: [tcp()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        peerDiscovery: [
          mdns(),
          ...(this.config.bootstrapPeers?.length ? [bootstrap({ list: this.config.bootstrapPeers })] : [])
        ],
        services: { pubsub: gossipsub({ emitSelf: false, fallbackToFloodsub: true }) },
        addresses: { listen: [`/ip4/0.0.0.0/tcp/${this.config.listenPort}`] }
      }
      this.node = await createLibp2p(options)
      await this.node.services.pubsub.subscribe('bucky/tasks')
      await this.node.services.pubsub.subscribe('bucky/consensus')
      await this.node.services.pubsub.subscribe('bucky/peers')
      this.node.services.pubsub.addEventListener('message', (event: CustomEvent<Message>) => {
        this.handleMessage(event.detail)
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.node.addEventListener('peer:discovery', (event: any) => { this.log('Discovered peer:', event.detail?.toString()) })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.node.addEventListener('peer:connect', (event: any) => { this.log('Connected to peer:', event.detail?.toString()) })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.node.addEventListener('peer:disconnect', (event: any) => { this.log('Disconnected from peer:', event.detail?.toString()) })
      await this.node.start()
      this.log('Node started. Peer ID:', this.node.peerId.toString())

      // Handle incoming inference requests from peers
      await this.node.handle('/bucky/inference/1.0.0', async ({ stream }: { stream: any }) => {
        const decoder = new TextDecoder()
        let jobData = ''
        for await (const chunk of stream.source) {
          jobData += decoder.decode((chunk as any).subarray ? (chunk as any).subarray() : chunk)
        }
        const job = JSON.parse(jobData)
        const result = await this.executeJobLocally(job)
        const encoder = new TextEncoder()
        await stream.sink([encoder.encode(JSON.stringify(result))])
      })

      await this.announceSelf()
      await this.announceCaps()
      setInterval(() => { this.announceCaps().catch(() => { /* swallow */ }) }, 30_000)
    } catch (err) {
      this.error('Failed to start node:', err)
      throw err
    }
  }

  private handleMessage(message: Message): void {
    try {
      const topic = message.topic
      const data = JSON.parse(new TextDecoder().decode(message.data)) as unknown
      switch (topic) {
        case 'bucky/tasks':
          this.taskHandlers.forEach(h => { try { h(data as MeshTask) } catch { /* skip */ } })
          break
        case 'bucky/consensus':
          this.voteHandlers.forEach(h => { try { h(data as ConsensusVote) } catch { /* skip */ } })
          break
        case 'bucky/peers':
          this.peerHandlers.forEach(h => { try { h(data as PeerInfo) } catch { /* skip */ } })
          break
      }
    } catch (err) {
      this.error('Error handling message:', err)
    }
  }

  async stop(): Promise<void> {
    if (this.node) { await this.node.stop(); this.node = null }
  }

  async publishTask(task: MeshTask): Promise<void> {
    if (!this.node) throw new Error('Node not started')
    await this.node.services.pubsub.publish('bucky/tasks', new TextEncoder().encode(JSON.stringify(task)))
  }

  async publishVote(vote: ConsensusVote): Promise<void> {
    if (!this.node) throw new Error('Node not started')
    await this.node.services.pubsub.publish('bucky/consensus', new TextEncoder().encode(JSON.stringify(vote)))
  }

  async sendInferenceToPeer(peerId: string, job: any): Promise<any> {
    if (!this.node) throw new Error('Node not started')
    const stream = await this.node.dialProtocol(peerId, '/bucky/inference/1.0.0')
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    await stream.sink([encoder.encode(JSON.stringify(job))])
    let result = ''
    for await (const chunk of stream.source) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result += decoder.decode((chunk as any).subarray ? (chunk as any).subarray() : chunk)
    }
    return JSON.parse(result)
  }

  private async executeJobLocally(job: any): Promise<any> {
    const LLAMACPP_URL = process.env.LLAMACPP_URL ?? 'http://localhost:8080'
    const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
    const start = Date.now()

    // Try llama-server
    try {
      const r = await fetch(`${LLAMACPP_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local',
          messages: [{ role: 'user', content: job.prompt }],
          max_tokens: job.maxTokens ?? 2048,
          temperature: job.temperature ?? 0.7,
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      })
      if (r.ok) {
        const d = await r.json() as any
        return { content: d.choices?.[0]?.message?.content ?? '', tokensGenerated: d.usage?.completion_tokens ?? 0, latencyMs: Date.now() - start, success: true }
      }
    } catch {}

    // Fallback: Ollama
    try {
      const r = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: job.model ?? 'llama3.2', prompt: job.prompt, stream: false }),
        signal: AbortSignal.timeout(120_000),
      })
      const d = await r.json() as any
      return { content: d.response ?? '', tokensGenerated: d.eval_count ?? 0, latencyMs: Date.now() - start, success: true }
    } catch (e: any) {
      return { content: '', tokensGenerated: 0, latencyMs: Date.now() - start, success: false, error: e.message }
    }
  }

  async announceCaps(models: string[] = []): Promise<void> {
    if (!this.node) throw new Error('Node not started')
    const LLAMACPP_URL = process.env.LLAMACPP_URL ?? 'http://localhost:8080'
    const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
    let localModels = models
    // Try llama-server models first
    try {
      const r = await fetch(`${LLAMACPP_URL}/v1/models`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        const d = await r.json() as any
        localModels = ((d.data || []) as any[]).map((m: any) => m.id as string)
      }
    } catch { /* no llama-server */ }
    // Merge Ollama models if llama-server returned nothing
    if (localModels.length === 0) {
      try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
        const d = await r.json()
        localModels = ((d.models || []) as any[]).map((m: any) => m.name as string)
      } catch { /* no ollama */ }
    }
    const caps = {
      type: 'mesh-llm:caps',
      nodeId: this.node.peerId.toString(),
      models: localModels,
      timestamp: Date.now()
    }
    await this.node.services.pubsub.publish('bucky/peers', new TextEncoder().encode(JSON.stringify(caps)))
  }

  async announceSelf(): Promise<void> {
    if (!this.node) throw new Error('Node not started')
    const announcement: PeerInfo = {
      nodeId: this.config.nodeId,
      peerId: this.node.peerId.toString(),
      capabilities: this.config.capabilities,
      timestamp: Date.now(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addresses: this.node.getMultiaddrs().map((addr: any) => addr.toString() as string)
    }
    await this.node.services.pubsub.publish('bucky/peers', new TextEncoder().encode(JSON.stringify(announcement)))
  }

  onTaskReceived(handler: (task: MeshTask) => void): void { this.taskHandlers.push(handler) }
  onVoteReceived(handler: (vote: ConsensusVote) => void): void { this.voteHandlers.push(handler) }
  onPeerDiscovered(handler: (peer: PeerInfo) => void): void { this.peerHandlers.push(handler) }

  getPeers(): string[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.node ? this.node.getPeers().map((p: any) => p.toString() as string) : []
  }

  getNodeId(): string {
    return this.node ? this.node.peerId.toString() : this.config.nodeId
  }
}
