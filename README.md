# Automation Studio

Schedule MUSD payments on Mezo Testnet with recipient limits, a fixed budget, cash protection and revocable execution.

[Live app](https://automation-studio-blue.vercel.app) · [Try the demo](https://automation-studio-blue.vercel.app/?mode=demo)

## Features

- Scheduled and one-time payments to an approved recipient.
- Group payments with a separate account, explicit recipients and a lifetime budget.
- Cash commitments, a minimum reserve and individual payment allocations.
- Owner approval through OKX Wallet, transaction tracking and confirmation feedback.
- Confirmed payment activity, public receipts and read-only schedule sharing.
- Cash-flow previews, execution monitoring and optional webhooks.

Demo mode uses simulated balances and sends no transactions. Live mode uses Mezo Testnet, chain ID `31611`; BTC pays gas and MUSD is the payment token.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open [localhost:3211](http://localhost:3211). Demo mode does not require a wallet. Development storage uses PGlite under `.data/automation-studio` when no database is configured.

For live use, configure a dedicated PostgreSQL database and the environment variables in `.env.example`. The web app loads its normal host or Next.js environment. Supply environment variables to the worker process separately.

## Execution

Execution is disabled by default. The owner deploys an account, funds it with test MUSD, approves its recipient and limits, allocates the payment budget, and grants a restricted executor permission. Never configure an owner private key on the server.

Choose either a continuously running worker or an authenticated scheduler calling the hosted tick endpoint:

```sh
npm run worker
```

The worker needs PostgreSQL, `STUDIO_EXECUTOR_ADDRESS`, `STUDIO_EXECUTOR_PRIVATE_KEY` and `STUDIO_AUTOMATION_EXECUTION=true`. Group execution additionally requires `STUDIO_V2_BATCH_EXECUTION=true`; its deployment interface requires `STUDIO_V2_BATCH_DEPLOYMENT=true`.

Cash protection must be confirmed onchain. Changed or expired protection prevents execution. Missed periods are not paid later. A prepared request or a transaction hash alone does not establish a completed payment.

The Cloudflare scheduler template is under `apps/scheduler`. Set its target URL to your deployment and configure `STUDIO_SCHEDULER_SECRET` on both services. Do not commit credentials.

## Verification

```sh
npm test
npm run typecheck
npm run build
forge test --root contracts
```

Foundry and Solidity 0.8.28 are required for contract tests. Fork tests are separate from local contract tests and require the appropriate RPC configuration.

## Confirmed testnet examples

- [Automatic 0.01 MUSD payment](https://explorer.test.mezo.org/tx/0xdbae257004f21e7f12e8a98e9cfb2aa622d07da40bb5a440c997a3d1ba4941db), block `16376961`.
- [Group payment: 0.01 MUSD to each of two recipients](https://explorer.test.mezo.org/tx/0xb8d7eb8fc1cdd158558549552134353ddf1db651738ec35ba267b2bf4f85912b), block `16380219`.

These are historical testnet transactions. They do not prove that a new installation has a funded executor or active permissions.

## Project layout

| Directory | Purpose |
| --- | --- |
| `apps/web` | Next.js interface and API |
| `apps/worker` | Monitoring, payment execution and webhook delivery |
| `apps/scheduler` | Cloudflare scheduled trigger |
| `contracts` | Solidity source, selected dependencies and tests |
| `packages/automation` | Scheduling, budgets and decision logic |
| `packages/db` | Storage, migrations and execution journal |
| `packages/mezo` | Chain adapters and receipt validation |
| `tests` | Application and integration tests |

For Vercel, set the root directory to `apps/web` and the install command to `cd ../.. && npm ci`.

## Scope and licenses

Automation Studio is independent from Mezora, with separate sessions, database, accounts and worker configuration. Automatic loan repayment and revenue splitting are not presented as completed live features.

The contracts are unaudited and intended for test assets. See [LICENSE](LICENSE), [third-party notices](docs/THIRD_PARTY_NOTICES.md) and the retained dependency licenses for source attribution.
