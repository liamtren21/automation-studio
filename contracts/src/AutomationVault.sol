// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Restricted recurring payouts for a fixed, non-rebasing, non-fee ERC20. Unaudited; local/test use.
/// @dev No arbitrary calls, upgrades or owner rotation. Owner can explicitly lower protection or release
/// allocations; these are separate authorized actions, never an executor bypass. Global spend is cumulative.
contract AutomationVault is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Policy {
        uint256 chainId;
        address vault;
        bytes32 policyId;
        uint256 version;
        address recipient;
        uint256 amount;
        uint256 startAt;
        uint256 endAt;
        uint256 intervalSeconds;
        uint256 perRunCap;
        uint256 perPeriodCap;
        uint256 lifetimeCap;
        uint256 priority;
        bool enabled;
    }
    IERC20 public immutable token;
    address public immutable owner;
    uint256 public immutable globalBudget;
    uint256 public globalSpent;
    uint256 public committedBills;
    uint256 public buffer;
    bytes32 public protectionSourceHash;
    uint256 public protectionExpiresAt;
    uint256 public totalAllocated;
    mapping(address => bool) public executors;
    mapping(bytes32 => Policy) private policies;
    mapping(bytes32 => uint256) public allocation;
    mapping(bytes32 => uint256) public lifetimeSpent;
    mapping(bytes32 => mapping(uint256 => bool)) public periodConsumed;
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidPolicy();
    error InvalidVersion();
    error ProtectionStale();
    error ProtectedFunds();
    error GlobalCap();
    error AllocationCap();
    error NotDue();
    error Expired();
    error PeriodChanged();
    error PeriodUsed();
    error RunCap();
    error PeriodCap();
    error LifetimeCap();
    error UnsupportedToken();
    event ExecutorSet(address indexed executor, bool allowed);
    event PolicyConfigured(bytes32 indexed policyId, uint256 indexed version, bytes32 policyHash);
    event PolicyRevoked(bytes32 indexed policyId, uint256 indexed version);
    event ProtectionSet(uint256 committedBills, uint256 buffer, bytes32 sourceHash, uint256 expiresAt);
    event BudgetAllocated(bytes32 indexed policyId, uint256 amount, uint256 remainingAllocation);
    event BudgetReleased(bytes32 indexed policyId, uint256 amount, uint256 remainingAllocation);
    event UnallocatedWithdrawn(address indexed recipient, uint256 amount);
    event PayoutExecuted(
        bytes32 indexed policyId,
        uint256 indexed version,
        uint256 indexed periodIndex,
        address recipient,
        uint256 amount,
        bytes32 policyHash
    );
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address token_, address owner_, uint256 globalBudget_) {
        if (token_ == address(0) || token_.code.length == 0 || owner_ == address(0) || globalBudget_ == 0) {
            revert InvalidConfiguration();
        }
        token = IERC20(token_);
        owner = owner_;
        globalBudget = globalBudget_;
    }

    function setExecutor(address executor, bool allowed) external onlyOwner {
        if (executor == address(0)) revert InvalidConfiguration();
        executors[executor] = allowed;
        emit ExecutorSet(executor, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function policyOf(bytes32 id) external view returns (Policy memory) {
        return policies[id];
    }

    /// @dev All fields are static ABI words: encoding this static tuple is byte-for-byte identical
    /// to flattened abi.encode(chainId,vault,policyId,version,recipient,amount,startAt,endAt,
    /// intervalSeconds,perRunCap,perPeriodCap,lifetimeCap,priority,enabled). No typehash/domain prefix.
    function hashPolicy(Policy memory p) public pure returns (bytes32) {
        return keccak256(abi.encode(p));
    }

    function configurePolicy(Policy calldata p) external onlyOwner {
        if (
            p.chainId == 0 || p.chainId != block.chainid || p.vault != address(this) || p.policyId == bytes32(0)
                || p.recipient == address(0) || p.recipient == address(this) || p.amount == 0 || p.intervalSeconds == 0
                || p.endAt <= p.startAt
        ) revert InvalidPolicy();
        Policy storage old = policies[p.policyId];
        if (p.version == 0 || p.version <= old.version || (old.version == 0 && p.version != 1)) {
            revert InvalidVersion();
        }
        // Freeze the period grid forever so an update cannot rename an already consumed period.
        if (old.version != 0 && (p.startAt != old.startAt || p.intervalSeconds != old.intervalSeconds)) {
            revert InvalidPolicy();
        }
        policies[p.policyId] = p;
        emit PolicyConfigured(p.policyId, p.version, hashPolicy(p));
    }

    function revokePolicy(bytes32 id) external onlyOwner {
        Policy storage p = policies[id];
        if (p.version == 0) revert InvalidPolicy();
        p.enabled = false;
        // Preserve the version, grid, consumed periods, lifetime spend and allocation.
        emit PolicyRevoked(id, p.version);
    }

    /// @notice Owner may explicitly lower a floor; execution never changes these protected amounts.
    function setProtection(uint256 committedBills_, uint256 buffer_, bytes32 sourceHash, uint256 expiresAt)
        external
        onlyOwner
        nonReentrant
    {
        if (sourceHash == bytes32(0) || expiresAt <= block.timestamp) revert InvalidConfiguration();
        committedBills = committedBills_;
        buffer = buffer_;
        protectionSourceHash = sourceHash;
        protectionExpiresAt = expiresAt;
        _requireFloor();
        emit ProtectionSet(committedBills_, buffer_, sourceHash, expiresAt);
    }

    function allocate(bytes32 id, uint256 amount) external onlyOwner nonReentrant {
        if (policies[id].version == 0 || amount == 0) revert InvalidConfiguration();
        totalAllocated += amount;
        allocation[id] += amount;
        if (globalSpent + totalAllocated > globalBudget) revert GlobalCap();
        _requireFloor();
        emit BudgetAllocated(id, amount, allocation[id]);
    }

    /// @notice Explicit owner release makes this allocation unallocated; it never resets globalSpent.
    function release(bytes32 id, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > allocation[id]) revert AllocationCap();
        allocation[id] -= amount;
        totalAllocated -= amount;
        emit BudgetReleased(id, amount, allocation[id]);
    }

    function withdrawUnallocated(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0) || recipient == address(this) || amount == 0) revert InvalidConfiguration();
        _requireFloor();
        uint256 bal = token.balanceOf(address(this));
        if (amount > bal - (committedBills + buffer + totalAllocated)) revert ProtectedFunds();
        _transferExact(recipient, amount);
        _requireFloor();
        emit UnallocatedWithdrawn(recipient, amount);
    }

    function executePayout(bytes32 id, uint256 expectedVersion, uint256 expectedPeriodIndex)
        external
        nonReentrant
        whenNotPaused
    {
        if (!executors[msg.sender]) revert Unauthorized();
        Policy memory p = policies[id];
        if (p.version == 0 || !p.enabled || p.chainId != block.chainid) revert InvalidPolicy();
        if (p.version != expectedVersion) revert InvalidVersion();
        if (protectionSourceHash == bytes32(0) || block.timestamp >= protectionExpiresAt) revert ProtectionStale();
        if (block.timestamp < p.startAt) revert NotDue();
        if (block.timestamp >= p.endAt) revert Expired();
        uint256 period = (block.timestamp - p.startAt) / p.intervalSeconds;
        if (period != expectedPeriodIndex) revert PeriodChanged();
        if (periodConsumed[id][period]) revert PeriodUsed();
        if (p.amount > p.perRunCap) revert RunCap();
        if (p.amount > p.perPeriodCap) revert PeriodCap();
        if (lifetimeSpent[id] + p.amount > p.lifetimeCap) revert LifetimeCap();
        if (globalSpent + p.amount > globalBudget) revert GlobalCap();
        if (allocation[id] < p.amount) revert AllocationCap();
        _requireFloor();
        periodConsumed[id][period] = true;
        lifetimeSpent[id] += p.amount;
        globalSpent += p.amount;
        allocation[id] -= p.amount;
        totalAllocated -= p.amount;
        _transferExact(p.recipient, p.amount);
        _requireFloor();
        emit PayoutExecuted(id, p.version, period, p.recipient, p.amount, hashPolicy(p));
    }

    function _requireFloor() private view {
        if (token.balanceOf(address(this)) < committedBills + buffer + totalAllocated) revert ProtectedFunds();
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 beforeVault = token.balanceOf(address(this));
        uint256 beforeRecipient = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (
            token.balanceOf(address(this)) != beforeVault - amount
                || token.balanceOf(recipient) != beforeRecipient + amount
        ) {
            revert UnsupportedToken();
        }
    }
}

