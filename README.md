# Abundance Protocol

**Open-source DePIN for distributed AI inference, decentralized compute, and peer-to-peer payments.**

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](./LICENSE)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%99%A1-ec4899?style=flat-square)](https://dirgha.ai/contribute)

---

Abundance Protocol is a peer-to-peer compute network. Nodes share GPU and CPU capacity
for AI inference workloads, coordinate through a gossipsub mesh, settle in Bitcoin
Lightning, and govern themselves through on-chain proposals. Anyone can join. No central
operator.

## What it does

| Layer | What it delivers |
|---|---|
| **Mesh** | libp2p node discovery, gossipsub routing, p2p inference job dispatch |
| **Inference** | Distributed LLM inference across heterogeneous GPU/CPU nodes |
| **Payments** | Lightning HODL invoices — payment escrowed until work is verified |
| **Consensus** | Commit-reveal consensus for task verification and dispute resolution |
| **DAO** | On-chain governance — proposals, voting, quorum, timelock execution |
| **Code Registry** | AST-level semantic deduplication of registered code blocks |
| **VM Isolation** | Firecracker microVM sandbox for untrusted compute tasks |
| **Reputation** | Per-node reputation scoring based on verified work history |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        HTTP API (Hono)                           │
│  /api/tasks  ·  /api/nodes  ·  /api/governance  ·  /api/health  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│                       BuckyDaemon                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │  mesh/node   │  │ TaskManager  │  │  ConsensusEngine      │   │
│  │  libp2p +    │  │ dispatch +   │  │  commit-reveal +      │   │
│  │  gossipsub   │  │ verification │  │  dispute resolution   │   │
│  └──────────────┘  └──────────────┘  └───────────────────────┘   │
│         │                │                     │                  │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────────▼──────────────┐   │
│  │ MeshLLM     │  │ Lightning   │  │  GovernanceEngine       │   │
│  │ distributed │  │ HODL escrow │  │  proposals + voting     │   │
│  │ inference   │  │ 70/20/10    │  │  on-chain execution     │   │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘   │
│                          │                                        │
│              ┌───────────▼───────────┐                            │
│              │      PeerStore        │                            │
│              │  (SQLite + pg)        │                            │
│              └───────────────────────┘                            │
└──────────────────────────────────────────────────────────────────┘
```

## Source tree

```
src/
├── daemon/           # Node entry point + hardware detection
├── server/           # Hono HTTP server + routes
├── mesh/             # libp2p node, gossipsub, discovery, routing
├── mesh-llm/         # Distributed inference adapter + peer selection
├── consensus/        # Commit-reveal consensus engine
├── payments/         # Lightning (Strike + LND) + HODL invoices
│   ├── lightning/    # Core payment operations (createInvoice, payInvoice)
│   └── hodl/         # HODL-specific: create, route, settle, cancel
├── dao/              # DAO governance: modules, persistence, schema
├── governance/       # Proposal lifecycle + voting engine
├── tasks/            # Task dispatch, verification, security pipeline
├── code-registry/    # AST dedup + semantic similarity
├── code/             # Parser, chunker, registry
├── vm/               # Firecracker microVM orchestration
├── sandbox/          # Sandbox manager + jailer
├── agents/           # Autonomous task agents
├── audit/            # Consensus verifier + threat modeling
├── reputation/       # Per-node reputation scoring
├── db/               # SQLite peer store
├── config/           # Node configuration
├── middleware/       # Request middleware (auth, security)
├── routes/           # HTTP route handlers
├── services/         # Shared service initialization
├── types/            # Shared TypeScript types
└── utils/            # Utilities (crypto, hash, timing)
```

## How payments work

Abundance uses Lightning HODL invoices to escrow payment until work is verified:

```
1. Client creates HODL invoice (payment locked by hash preimage)
2. Node does the work
3. ConsensusEngine verifies output (commit-reveal)
4. Preimage revealed → payment settles
5. 70% to worker · 20% to protocol · 10% to treasury
```

If consensus fails or the node doesn't deliver, the HODL invoice expires and
the client gets their sats back. No intermediary holds funds.

## Quick start

```bash
# Install
npm install @dirgha/abundance-protocol

# Environment
export BUCKY_NODE_ID=my-node
export BUCKY_PORT=3002
export BOOTSTRAP_PEERS=                    # optional: comma-separated multiaddrs

# Lightning (optional — credit-only mode if not set)
export LND_SOCKET=localhost:10009
export LND_MACAROON=<hex-encoded-macaroon>
# or
export LND_SOCKET=<path-to-socket>
export LND_MACAROON_PATH=<path-to-macaroon>

# Start the daemon
npx tsx src/daemon/index.ts
```

## Programmatic API

```typescript
import { BuckyNode } from '@dirgha/abundance-protocol/mesh/node';
import { MeshLLMAdapter } from '@dirgha/abundance-protocol/mesh-llm/adapter';
import { LightningService } from '@dirgha/abundance-protocol/payments/lightning/service';

const node = new BuckyNode({
  nodeId: 'my-node',
  listenPort: 3002,
  bootstrapPeers: [],
  stakeAmount: 0,
  capabilities: {
    cpu: { cores: 8, model: 'x86_64' },
    memory: 16384,
    storage: 0,
    bandwidth: 0,
    gpu: { model: 'RTX 4090', vram: 24 },
  },
  lightning: { type: 'strike' },
});

await node.start();
console.log('Node ID:', node.getNodeId());
```

## Configuration

```bash
# Node identity
BUCKY_NODE_ID=my-unique-node-id    # default: random string
BUCKY_PORT=3002                    # libp2p listen port (default 3002)
BUCKY_STAKE_AMOUNT=0               # sats staked (for future slashing)

# Bootstrap
BOOTSTRAP_PEERS=                   # comma-separated multiaddrs

# Lightning
LND_SOCKET=localhost:10009
LND_MACAROON=<hex>
LND_CERT=<path-to-tls.cert>        # optional
# Strike (alternative)
STRIKE_API_KEY=<key>

# Database
DATABASE_URL=postgres://...        # if using Postgres; defaults to SQLite

# VM isolation
FIRECRACKER_SOCKET=/var/run/firecracker.sock
FIRECRACKER_KERNEL=/opt/abundance/vmlinux
FIRECRACKER_ROOTFS=/opt/abundance/rootfs.ext4
MAX_VMS=4
```

## Governance

Governance proposals are created, voted on, and executed on-chain. Any staked
node can open a proposal. Quorum and approval thresholds are configurable:

```typescript
import { GovernanceEngine } from '@dirgha/abundance-protocol/governance/engine';

const gov = new GovernanceEngine({
  quorumPercent: 10,           // 10% of supply must vote
  standardThreshold: 60,      // 60% yes to pass
  criticalThreshold: 75,      // 75% yes for critical changes
  votingPeriodMs: 7 * 86400_000,
  timelockMs: 2 * 86400_000,
  totalSupply: 1_000_000,
});
```

## Development

```bash
git clone https://github.com/dirghaai/abundance-protocol.git
cd abundance-protocol
npm install

npm run typecheck    # 0 errors
npm test             # vitest
npm run dev          # tsx watch src/daemon/index.ts
npm run build        # tsc → dist/
```

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md). New subsystem adapters (storage
backends, alternative payment rails, new VM runtimes) are especially welcome.

The pattern:
1. Implement the relevant interface from `src/types/index.ts`
2. Wire into `src/services/core.ts`
3. Add a test in `tests/` that stubs external dependencies

## License

**Apache License 2.0.** Free for any use — personal, commercial, research,
hosted, redistributed. Full text in [`LICENSE`](./LICENSE).

## Security

Found a vulnerability in Abundance Protocol? Email `security@dirgha.ai`.
Do NOT open a public issue. We respond within 48 hours.

## Support

- Website: https://dirgha.ai/abundance-protocol
- Issues: https://github.com/dirghaai/abundance-protocol/issues
- Sponsor: https://dirgha.ai/contribute

---

Built by Dirgha LLC. Named after Buckminster Fuller — architect of abundance.

Copyright 2026 Dirgha LLC.
