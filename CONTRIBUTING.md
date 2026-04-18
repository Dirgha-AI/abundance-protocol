# Contributing to Abundance Protocol

Thanks for helping. Abundance Protocol is open infrastructure — the more contributors,
the more resilient it gets.

## Before your first PR

1. **Sign the CLA.** Include this line in your PR description:
   > I have read and agree to the Dirgha AI Contributor License Agreement
   > at CLA.md, and I submit this Contribution under those terms.

2. **Read the [LICENSE](LICENSE).** Apache-2.0 — contributions inherit that license.

## What belongs here

- New node backends (storage, transport, VM runtimes)
- Payment rail adapters (Strike, LND, on-chain Bitcoin)
- Consensus variants or verification heuristics
- Governance module extensions
- CLI improvements
- Performance work (parallel executor, peer selection strategies)
- Tests

**Does not belong here:** billing, quota enforcement, closed-source attack packs.

## Pull requests

- Branch from `main`
- `npm run typecheck` — zero TypeScript errors
- `npm test` — all tests green
- New subsystems: include test that stubs external deps
- One PR per concern
- Reference issue number if there is one (`Fixes #123`)

## Code style

- TypeScript strict mode
- No new npm dependencies without justification
- Each subsystem lives in its own directory under `src/`
- Export interfaces from `src/types/index.ts`
- Comments explain **why**, not **what**

## Questions

- Issues: https://github.com/dirghaai/abundance-protocol/issues
- Security: security@dirgha.ai
- General: team@dirgha.ai
