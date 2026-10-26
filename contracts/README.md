# Contracts

`AutomationVault.sol` supports fixed-recipient scheduled MUSD payments. `AutomationAccountV2.sol` adds a separate account and bounded group-payment policies. Both target Mezo Testnet (chain ID 31611).

Run `forge test --root contracts` with Solidity 0.8.28. Tests cover budgets, cash floors, replay prevention, policy changes, schedule periods, executor permissions and invariants. Fork tests are opt-in and do not broadcast transactions.

The owner can change cash protection or release allocations. These are owner-controlled cash settings, not creditor escrow. Expired or changed protection prevents scheduled execution. Withdrawals obey stored reserves and allocations.

The V2 contract contains additional adapter foundations. Their presence does not mean every path has a live user flow or hosted worker support; live group execution is limited to the supported batch-payment adapter.

The contracts are unaudited and intended for test assets. They do not expose arbitrary target calls or upgrades.

The deployment adapters use compiled artifacts in `packages/mezo/src/automation-build.json` and `packages/mezo/src/automation-v2-artifact.ts` to verify deployed code and immutable parameters. Update artifacts only alongside the corresponding verified contract build.
