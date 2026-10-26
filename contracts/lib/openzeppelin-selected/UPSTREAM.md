# OpenZeppelin selected sources

Source: https://github.com/OpenZeppelin/openzeppelin-contracts

Pinned release: `v5.4.0`.
Pinned commit: `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0`.
License: MIT; original LICENSE is preserved beside this notice.

The Solidity sources under `contracts/` are copied without modification. Only the
dependency closure of SafeERC20, ReentrancyGuard, Pausable and ERC20 is included.
ERC20 is used by the local test token only. Sources retain original SPDX notices.
There is no upstream Git metadata, build tooling or package execution in this copy.

Mezora uses SafeERC20 for transfers, ReentrancyGuard for mutation callbacks and
Pausable for selective pause behavior. Immutable ownership and commitment logic
are original Mezora implementation; OpenZeppelin Ownable is not used because its
ownership transfer and renunciation surface does not match the immutable policy.
