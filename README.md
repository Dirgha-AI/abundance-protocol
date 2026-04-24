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

## Sister projects in the Dirgha OS

This repo is one of five that make up the open-source surface of the Dirgha OS. Each repo stands on its own; together they compose a full stack for builders.

| Repo | What it does | License |
|---|---|---|
| [`dirgha-code`](https://github.com/dirghaai/dirgha-code) | Terminal-native AI coding agent. BYOK, 14 providers, 43 tools, fleet-mode multi-agent. | FSL-1.1-MIT |
| [`creator-studio`](https://github.com/dirghaai/creator-studio) | Backend API for the creator economy. Monetization, campaigns, memberships, social integrations. | Apache-2.0 |
| [`writer-studio`](https://github.com/dirghaai/writer-studio) | Backend API for writing — science, fiction, screenplays, research. Binder + AI research + RAG. | Apache-2.0 |
| [`arniko`](https://github.com/dirghaai/arniko) | AI security scanning. 36 scanner adapters unified into one stream of typed findings. | Apache-2.0 |

Visit the umbrella org at [github.com/dirghaai](https://github.com/dirghaai) or the product site at [dirgha.ai](https://dirgha.ai).

## License

**Apache License 2.0** — free for any use: personal, commercial, research, hosted, redistributed. Run nodes, fork the protocol, build a competing network. Full text in [`LICENSE`](./LICENSE).

**Dirgha LLC owns the “Dirgha” name, logo, and product family** as registered trademarks. The code is open — the brand isn't. Forks of this repository must rename the product and remove Dirgha branding before distribution. Reasonable nominative use (“a fork of Abundance Protocol”) is fine.

See [`LICENSE`](./LICENSE) for the full legal text. Related documents:

- [`SECURITY.md`](./SECURITY.md) — vulnerability disclosure policy.
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [`SUPPORT.md`](./SUPPORT.md) — where to ask for help.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to send a PR.


## Contribute

- **Code** — fork, branch, PR against `main`. Recipes in [`CONTRIBUTING.md`](./CONTRIBUTING.md).
- **Bugs** — file an issue using the [bug template](https://github.com/dirghaai/abundance-protocol/issues/new?template=bug.md).
- **Features** — file an issue using the [feature template](https://github.com/dirghaai/abundance-protocol/issues/new?template=feature.md).
- **Questions** — open a [Discussion](https://github.com/dirghaai/abundance-protocol/discussions) rather than an issue.
- **Security** — email `security@dirgha.ai`. Do NOT file a public issue for vulnerabilities.
- **Sponsor** — [dirgha.ai/contribute](https://dirgha.ai/contribute) · Lightning, GitHub Sponsors, OpenCollective.
- **First-time contributor?** Your first PR will ask you to sign the CLA (see [`CLA.md`](./CLA.md)). Small doc fixes don't need one.

## Links

| | |
|---|---|
| Website | [https://dirgha.ai/abundance-protocol](https://dirgha.ai/abundance-protocol) |
| Repository | [github.com/dirghaai/abundance-protocol](https://github.com/dirghaai/abundance-protocol) |
| Issues | [github.com/dirghaai/abundance-protocol/issues](https://github.com/dirghaai/abundance-protocol/issues) |
| Discussions | [github.com/dirghaai/abundance-protocol/discussions](https://github.com/dirghaai/abundance-protocol/discussions) |
| Security | `security@dirgha.ai` |
| Enterprise | `enterprise@dirgha.ai` |
| Press / general | `hello@dirgha.ai` |

---

**Abundance Protocol** is part of the Dirgha OS — open-source infrastructure for builders, shipped by a small bootstrapped team.

Named after Buckminster Fuller — architect of abundance. The protocol's thesis: compute is post-scarcity if you route it right.

Built by [Dirgha LLC](https://dirgha.ai) in India. Open to the world.

Released under **Apache-2.0** · Copyright © 2026 Dirgha LLC · All third-party trademarks are property of their owners.

---

## 🌐 The Dirgha Ecosystem

**[Dirgha AI OS](https://github.com/Dirgha-AI/Rama-I-Dirgha-AI-OS)** — the agentic operating system. *Accelerate Abundance.*

| Repo | What it does |
|---|---|
| [Rama-I-Dirgha-AI-OS](https://github.com/Dirgha-AI/Rama-I-Dirgha-AI-OS) | Vision, architecture, and the Rama I sovereign compute challenge |
| [abundance-protocol](https://github.com/Dirgha-AI/abundance-protocol) | P2P compute mesh for distributed AI inference |
| [arniko](https://github.com/Dirgha-AI/arniko) | Security scanner and red-teaming agent |
| [dirgha-code](https://github.com/Dirgha-AI/dirgha-code) | Autonomous software engineering CLI (`@dirgha/cli`) |
| [creator-studio](https://github.com/Dirgha-AI/creator-studio) | AI-native media production workspace |
| [writer-studio](https://github.com/Dirgha-AI/writer-studio) | AI-native document workspace |
| [.github](https://github.com/Dirgha-AI/.github) | Org profile and community configuration |

- **Live platform:** [dirgha.ai](https://dirgha.ai) — chat, IDE, writer, research, library, marketplace, creator, education, manufacturing
- **Organization:** [github.com/Dirgha-AI](https://github.com/Dirgha-AI)
- **Partnerships:** [partner@dirgha.ai](mailto:partner@dirgha.ai)

*Dirgha — Accelerate Abundance. Built in India, for the world.*
