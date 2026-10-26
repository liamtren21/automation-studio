// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IMezoOperationsV2 {
    function minNetDebt() external view returns (uint256);
    function MUSD_GAS_COMPENSATION() external view returns (uint256);
    function repayMUSD(uint256, address, address) external;
    function openTrove(uint256, address, address) external payable;
    function addColl(address, address) external payable;
    function closeTrove() external;
    function claimCollateral() external;
}

interface IMezoTroveV2 {
    function getTroveStatus(address) external view returns (uint8);
    function getEntireDebtAndColl(address) external view returns (uint256, uint256, uint256, uint256, uint256, uint256);
}

/// @notice Immutable, unaudited LOCAL foundation. No deployed compatibility with AutomationVault.
/// @dev Conservation: token balance = capitalFree + revenueFree + totalAllocated + unclassified().
/// Allocation is a reclassification, never an additional revenue reserve. committed+buffer is a floor
/// on free/unclassified funds, additional to allocations. Only explicit revenue deposits earn split credits.
/// Protocol proxies remain upgradeable: implementation identity MUST be checked offchain before signing/execution.
contract AutomationAccountV2 is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Policy {
        bytes32 id;
        uint256 version;
        uint8 kind;
        uint256 startAt;
        uint256 endAt;
        uint256 interval;
        uint256 runCap;
        uint256 periodCap;
        uint256 lifetimeCap;
        bool enabled;
    }
    IERC20 public immutable token;
    address public immutable owner;
    uint256 public immutable globalBudget;
    uint256 public immutable deploymentChainId;
    IMezoOperationsV2 public immutable operations;
    IMezoTroveV2 public immutable troveManager;
    uint256 public globalSpent;
    uint256 public committed;
    uint256 public buffer;
    uint256 public protectionExpiry;
    uint256 public capitalFree;
    uint256 public revenueFree;
    uint256 public totalAllocated;
    mapping(address => bool) public executors;
    mapping(bytes32 => Policy) private policies;
    mapping(bytes32 => address[]) private payees;
    mapping(bytes32 => uint256[]) private values;
    mapping(bytes32 => mapping(address => uint256)) public splitCredit;
    mapping(bytes32 => uint256) public allocation;
    mapping(bytes32 => uint256) public lifetimeSpent;
    mapping(bytes32 => mapping(uint256 => bool)) public periodConsumed;
    error Unauthorized();
    error Invalid();
    error Floor();
    error Cap();
    error UnsupportedToken();
    event Configured(bytes32 indexed id, uint256 version, bytes32 configurationHash);
    event Classified(bytes32 indexed id, bool revenue, uint256 amount, uint256 allocated);
    event Executed(bytes32 indexed id, uint256 version, uint256 period, uint256 amount, uint8 kind);
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address t, address o, uint256 cap, address bo, address tm) {
        if (t.code.length == 0 || o == address(0) || cap == 0 || bo.code.length == 0 || tm.code.length == 0) {
            revert Invalid();
        }
        token = IERC20(t);
        owner = o;
        globalBudget = cap;
        deploymentChainId = block.chainid;
        operations = IMezoOperationsV2(bo);
        troveManager = IMezoTroveV2(tm);
    }
    receive() external payable {}

    function setExecutor(address e, bool allowed) external onlyOwner {
        if (e == address(0) || e == owner) revert Invalid();
        executors[e] = allowed;
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

    function payeesOf(bytes32 id) external view returns (address[] memory, uint256[] memory) {
        return (payees[id], values[id]);
    }

    function unclassified() public view returns (uint256) {
        return token.balanceOf(address(this)) - capitalFree - revenueFree - totalAllocated;
    }

    function setProtection(uint256 c, uint256 b, bytes32 evidence, uint256 expiry) external onlyOwner nonReentrant {
        if (evidence == bytes32(0) || expiry <= block.timestamp) revert Invalid();
        committed = c;
        buffer = b;
        protectionExpiry = expiry;
        _floor();
    }

    function depositCapital(uint256 n) external onlyOwner nonReentrant {
        _deposit(n);
        capitalFree += n;
        emit Classified(bytes32(0), false, n, 0);
    }

    /// Direct transfers stay unclassified until an explicit owner action. Cannot classify them as revenue.
    function classifyCapital(uint256 n) external onlyOwner nonReentrant {
        if (n == 0 || n > unclassified()) revert Invalid();
        capitalFree += n;
        emit Classified(bytes32(0), false, n, 0);
    }

    function configure(Policy calldata p, address[] calldata recipients, uint256[] calldata amounts)
        external
        onlyOwner
    {
        Policy storage old = policies[p.id];
        if (
            p.id == bytes32(0) || p.version != old.version + 1 || p.kind > 2 || p.interval == 0 || p.endAt <= p.startAt
                || p.runCap == 0 || p.periodCap == 0 || p.lifetimeCap == 0
        ) revert Invalid();
        if (old.version != 0 && (p.startAt != old.startAt || p.interval != old.interval || p.kind != old.kind)) {
            revert Invalid();
        }
        if (p.kind == 2) {
            if (recipients.length != 0 || amounts.length != 1 || amounts[0] == 0) revert Invalid();
        } else {
            if (recipients.length == 0 || recipients.length > 20 || recipients.length != amounts.length) {
                revert Invalid();
            }
            uint256 sum;
            for (uint256 i; i < recipients.length; i++) {
                if (recipients[i] == address(0) || recipients[i] == address(this) || amounts[i] == 0) revert Invalid();
                for (uint256 j; j < i; j++) {
                    if (recipients[i] == recipients[j]) revert Invalid();
                }
                // Freeze split recipients to retain all accrued credits. Weight changes affect future deposits only.
                if (
                    p.kind == 1 && old.version != 0
                        && (recipients.length != payees[p.id].length || recipients[i] != payees[p.id][i])
                ) revert Invalid();
                sum += amounts[i];
            }
            // Sum below 10000 explicitly retains the remainder, and per-recipient division dust, as revenueFree.
            if (p.kind == 1 && sum > 10000) revert Invalid();
        }
        policies[p.id] = p;
        payees[p.id] = recipients;
        values[p.id] = amounts;
        emit Configured(p.id, p.version, keccak256(abi.encode(block.chainid, address(this), p, recipients, amounts)));
    }

    function revoke(bytes32 id) external onlyOwner {
        if (policies[id].version == 0) revert Invalid();
        policies[id].enabled = false;
    }

    function depositRevenue(bytes32 id, uint256 n) external onlyOwner nonReentrant {
        Policy memory p = policies[id];
        if (p.kind != 1 || p.version == 0 || !p.enabled || block.timestamp >= p.endAt) revert Invalid();
        _deposit(n);
        uint256 credited;
        for (uint256 i; i < payees[id].length; i++) {
            uint256 share = n * values[id][i] / 10000;
            splitCredit[id][payees[id][i]] += share;
            credited += share;
        }
        allocation[id] += credited;
        totalAllocated += credited;
        revenueFree += n - credited;
        if (globalSpent + totalAllocated > globalBudget) revert Cap();
        _floor();
        emit Classified(id, true, n, credited);
    }

    function allocate(bytes32 id, uint256 n, bool fromRevenue) external onlyOwner nonReentrant {
        if (policies[id].version == 0 || policies[id].kind == 1 || n == 0) revert Invalid();
        if (fromRevenue) {
            if (n > revenueFree) revert Cap();
            revenueFree -= n;
        } else {
            if (n > capitalFree) revert Cap();
            capitalFree -= n;
        }
        allocation[id] += n;
        totalAllocated += n;
        if (globalSpent + totalAllocated > globalBudget) revert Cap();
        _floor();
    }

    /// Releases non-split allocation as capital. Split credits remain bound to their snapshotted recipients.
    function release(bytes32 id, uint256 n) external onlyOwner nonReentrant {
        if (policies[id].kind == 1 || n == 0 || n > allocation[id]) revert Invalid();
        allocation[id] -= n;
        totalAllocated -= n;
        capitalFree += n;
    }

    /// @notice Explicit owner release cancels snapshotted split credit without turning capital into revenue.
    function releaseSplit(bytes32 id, address recipient, uint256 n) external onlyOwner nonReentrant {
        if (policies[id].kind != 1 || n == 0 || n > splitCredit[id][recipient]) revert Invalid();
        splitCredit[id][recipient] -= n;
        allocation[id] -= n;
        totalAllocated -= n;
        revenueFree += n;
    }

    function execute(bytes32 id, uint256 version, uint256 period, address upper, address lower)
        external
        nonReentrant
        whenNotPaused
    {
        if (!executors[msg.sender]) revert Unauthorized();
        Policy memory p = policies[id];
        if (
            block.chainid != deploymentChainId || !p.enabled || p.version == 0 || p.version != version
                || block.timestamp < p.startAt || block.timestamp >= p.endAt || block.timestamp >= protectionExpiry
                || (block.timestamp - p.startAt) / p.interval != period || periodConsumed[id][period]
        ) revert Invalid();
        uint256 n;
        if (p.kind == 1) {
            for (uint256 i; i < payees[id].length; i++) {
                n += splitCredit[id][payees[id][i]];
            }
        } else if (p.kind == 2) {
            n = values[id][0];
        } else {
            for (uint256 i; i < values[id].length; i++) {
                n += values[id][i];
            }
        }
        if (
            n == 0 || n > p.runCap || n > p.periodCap || lifetimeSpent[id] + n > p.lifetimeCap
                || globalSpent + n > globalBudget || n > allocation[id]
        ) revert Cap();
        _floor();
        periodConsumed[id][period] = true;
        lifetimeSpent[id] += n;
        globalSpent += n;
        allocation[id] -= n;
        totalAllocated -= n;
        if (p.kind == 2) {
            _repay(n, upper, lower);
        } else {
            for (uint256 i; i < payees[id].length; i++) {
                address recipient = payees[id][i];
                uint256 amount = p.kind == 1 ? splitCredit[id][recipient] : values[id][i];
                if (p.kind == 1) splitCredit[id][recipient] = 0;
                if (amount != 0) _transfer(recipient, amount);
            }
        }
        _floor();
        emit Executed(id, version, period, n, p.kind);
    }

    function _repay(uint256 n, address u, address l) private {
        if (troveManager.getTroveStatus(address(this)) != 1) revert Invalid();
        (uint256 coll, uint256 principal, uint256 interest,,,) = troveManager.getEntireDebtAndColl(address(this));
        uint256 debt = principal + interest;
        uint256 floor = operations.minNetDebt() + operations.MUSD_GAS_COMPENSATION();
        if (debt < floor || n > debt - floor) revert Floor();
        uint256 beforeBalance = token.balanceOf(address(this));
        operations.repayMUSD(n, u, l);
        (uint256 afterColl, uint256 afterPrincipal, uint256 afterInterest,,,) =
            troveManager.getEntireDebtAndColl(address(this));
        if (
            token.balanceOf(address(this)) != beforeBalance - n || afterColl != coll
                || afterPrincipal + afterInterest != debt - n || troveManager.getTroveStatus(address(this)) != 1
        ) revert UnsupportedToken();
    }

    function openLoan(uint256 n, address u, address l) external payable onlyOwner nonReentrant {
        if (n == 0 || msg.value == 0 || troveManager.getTroveStatus(address(this)) == 1) revert Invalid();
        uint256 beforeBalance = token.balanceOf(address(this));
        operations.openTrove{value: msg.value}(n, u, l);
        if (token.balanceOf(address(this)) != beforeBalance + n || troveManager.getTroveStatus(address(this)) != 1) {
            revert UnsupportedToken();
        }
        capitalFree += n;
        _floor();
    }

    function topUp(address u, address l) external payable onlyOwner nonReentrant {
        if (msg.value == 0) revert Invalid();
        operations.addColl{value: msg.value}(u, l);
    }

    function closeLoan() external onlyOwner nonReentrant {
        uint256 beforeBalance = token.balanceOf(address(this));
        operations.closeTrove();
        uint256 debit = beforeBalance - token.balanceOf(address(this));
        _consumeFree(debit);
        _floor();
    }

    function claimSurplus() external onlyOwner nonReentrant {
        operations.claimCollateral();
    }

    function withdrawFree(address recipient, uint256 n) external onlyOwner nonReentrant {
        if (n == 0 || recipient == address(0) || recipient == address(this)) revert Invalid();
        _consumeFree(n);
        _transfer(recipient, n);
        _floor();
    }

    function recoverNative(address payable recipient, uint256 n) external onlyOwner nonReentrant {
        if (recipient == address(0) || recipient == address(this) || n == 0) revert Invalid();
        (bool ok,) = recipient.call{value: n}("");
        if (!ok) revert Invalid();
    }

    function _consumeFree(uint256 n) private {
        if (n > capitalFree + revenueFree) revert Cap();
        uint256 c = n > capitalFree ? capitalFree : n;
        capitalFree -= c;
        revenueFree -= n - c;
    }

    function _floor() private view {
        if (token.balanceOf(address(this)) < committed + buffer + totalAllocated) revert Floor();
    }

    function _deposit(uint256 n) private {
        if (n == 0) revert Invalid();
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 beforeOwner = token.balanceOf(owner);
        token.safeTransferFrom(owner, address(this), n);
        if (token.balanceOf(address(this)) != beforeBalance + n || token.balanceOf(owner) != beforeOwner - n) {
            revert UnsupportedToken();
        }
    }

    function _transfer(address r, uint256 n) private {
        uint256 b = token.balanceOf(address(this));
        uint256 p = token.balanceOf(r);
        token.safeTransfer(r, n);
        if (token.balanceOf(address(this)) != b - n || token.balanceOf(r) != p + n) revert UnsupportedToken();
    }
}

