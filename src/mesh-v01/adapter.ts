// Legacy mesh-v01 adapter — superseded by mesh/ (libp2p-based).
// Kept for API surface compatibility; non-functional stub.

export class BuckyMeshV01 {
  constructor(
    private readonly nodeId: string,
    private readonly bootstrapPeers: string[]
  ) {}

  getNodeId(): string { return this.nodeId; }
  getPeers(): string[] { return []; }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
