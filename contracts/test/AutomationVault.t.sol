// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AutomationVault} from "../src/AutomationVault.sol";

interface VmAutomation {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
}

contract AutomationToken is ERC20 {
    bool public fail;
    bool public steal;
    address public callback;
    bytes public payload;
    bool public callbackSucceeded;
    constructor() ERC20("Test MUSD", "MUSD") {}

    function mint(address a, uint256 n) external {
        _mint(a, n);
    }

    function burn(address a, uint256 n) external {
        _burn(a, n);
    }

    function mode(bool f, bool s, address c, bytes calldata p) external {
        fail = f;
        steal = s;
        callback = c;
        payload = p;
    }

    function transfer(address to, uint256 n) public override returns (bool) {
        if (fail) return false;
        if (callback != address(0)) (callbackSucceeded,) = callback.call(payload);
        return super.transfer(to, steal ? n - 1 : n);
    }
}

contract AutomationVaultTest {
    VmAutomation constant vm = VmAutomation(address(uint160(uint256(keccak256("hevm cheat code")))));
    AutomationToken token;
    AutomationVault vault;
    bytes32 constant ID = bytes32(uint256(1));
    address constant PAYEE = address(0xbeef);
    address constant EXEC = address(0xa);

    function setUp() public {
        vm.warp(100);
        token = new AutomationToken();
        vault = new AutomationVault(address(token), address(this), 30);
        token.mint(address(vault), 50);
        vault.setExecutor(EXEC, true);
        vault.setProtection(10, 10, bytes32(uint256(1)), 1000);
        vault.configurePolicy(policy());
        vault.allocate(ID, 30);
    }

    function policy() internal view returns (AutomationVault.Policy memory) {
        return AutomationVault.Policy(block.chainid, address(vault), ID, 1, PAYEE, 5, 100, 1000, 10, 5, 5, 30, 1, true);
    }

    function pay(uint256 period) internal {
        vm.prank(EXEC);
        vault.executePayout(ID, 1, period);
    }

    function testSixPayoutsProtectTwentyAndSeventhFails() public {
        for (uint256 i; i < 6; i++) {
            vm.warp(100 + i * 10);
            pay(i);
        }
        require(token.balanceOf(address(vault)) == 20);
        require(vault.totalAllocated() == 0);
        require(vault.globalSpent() == 30);
        vm.warp(160);
        vm.expectRevert();
        pay(6);
    }

    function testTwoExecutorsCannotUseSamePeriod() public {
        vault.setExecutor(address(0xb), true);
        pay(0);
        vm.prank(address(0xb));
        vm.expectRevert();
        vault.executePayout(ID, 1, 0);
    }

    function testUpdateAndRevokePreserveCountersAndSchedule() public {
        pay(0);
        vault.revokePolicy(ID);
        AutomationVault.Policy memory p = policy();
        p.version = 2;
        vault.configurePolicy(p);
        require(vault.lifetimeSpent(ID) == 5);
        require(vault.periodConsumed(ID, 0));
        vm.prank(EXEC);
        vm.expectRevert();
        vault.executePayout(ID, 2, 0);
        p.version = 3;
        p.startAt = 110;
        vm.expectRevert();
        vault.configurePolicy(p);
        p.startAt = 100;
        p.intervalSeconds = 20;
        vm.expectRevert();
        vault.configurePolicy(p);
        p.intervalSeconds = 10;
        p.version = 2;
        vm.expectRevert();
        vault.configurePolicy(p);
    }

    function testWrongPeriodVersionNotDueAndExpiry() public {
        vm.warp(99);
        vm.expectRevert();
        pay(0);
        vm.warp(110);
        vm.expectRevert();
        pay(0);
        vm.prank(EXEC);
        vm.expectRevert();
        vault.executePayout(ID, 2, 1);
        pay(1);
        require(!vault.periodConsumed(ID, 0));
        vm.warp(1000);
        vm.expectRevert();
        pay(90);
    }

    function testStaleProtectionAndPauseExecutor() public {
        vault.setProtection(10, 10, bytes32(uint256(2)), 101);
        vm.warp(101);
        vm.expectRevert();
        pay(0);
        vault.setProtection(10, 10, bytes32(uint256(2)), 1000);
        vault.pause();
        vm.expectRevert();
        pay(0);
        vault.unpause();
        vault.setExecutor(EXEC, false);
        vm.expectRevert();
        pay(0);
    }

    function testChangedChainCannotExecuteConfiguredPolicy() public {
        vm.chainId(block.chainid + 1);
        vm.expectRevert();
        pay(0);
    }

    function testInitialVersionMustBeOne() public {
        AutomationVault.Policy memory p = policy();
        p.policyId = bytes32(uint256(2));
        p.version = 2;
        vm.expectRevert();
        vault.configurePolicy(p);
    }

    function testTwoPolicyAllocationsStayIsolatedThroughInterleaving() public {
        bytes32 second = bytes32(uint256(2));
        AutomationVault.Policy memory p = policy();
        p.policyId = second;
        p.recipient = address(0xcafe);
        vault.configurePolicy(p);
        vault.release(ID, 15);
        vault.allocate(second, 15);
        require(vault.allocation(ID) == 15 && vault.allocation(second) == 15);
        pay(0);
        require(vault.allocation(ID) == 10 && vault.allocation(second) == 15);
        vm.prank(EXEC);
        vault.executePayout(second, 1, 0);
        require(vault.allocation(ID) == 10 && vault.allocation(second) == 10);
        require(vault.globalSpent() == 10 && vault.totalAllocated() == 20);
        // A's release creates free cash, but withdrawing it cannot consume B's allocation.
        vault.release(ID, 5);
        vault.withdrawUnallocated(PAYEE, 5);
        vm.expectRevert();
        vault.withdrawUnallocated(PAYEE, 1);
        vm.expectRevert();
        vault.allocate(ID, 1);
        // Restore funded cash, then move A's released budget to B without resetting spend.
        token.mint(address(vault), 5);
        vault.allocate(second, 5);
        vm.expectRevert();
        vault.allocate(ID, 1);
        vm.warp(110);
        pay(1);
        vm.prank(EXEC);
        vault.executePayout(second, 1, 1);
        require(vault.allocation(ID) == 0 && vault.allocation(second) == 10);
        require(vault.lifetimeSpent(ID) == 10 && vault.lifetimeSpent(second) == 10);
        vm.warp(120);
        vm.expectRevert();
        pay(2);
        vm.prank(EXEC);
        vault.executePayout(second, 1, 2);
        vm.warp(130);
        vm.prank(EXEC);
        vault.executePayout(second, 1, 3);
        require(vault.globalSpent() == 30 && vault.totalAllocated() == 0);
        require(token.balanceOf(address(vault)) == 20);
        token.mint(address(vault), 5);
        vm.expectRevert();
        vault.allocate(ID, 1);
        require(token.balanceOf(PAYEE) == 15 && token.balanceOf(address(0xcafe)) == 20);
    }

    function testCaps() public {
        AutomationVault.Policy memory p = policy();
        p.version = 2;
        p.perRunCap = 4;
        vault.configurePolicy(p);
        vm.prank(EXEC);
        vm.expectRevert();
        vault.executePayout(ID, 2, 0);
        p.version = 3;
        p.perRunCap = 5;
        p.perPeriodCap = 4;
        vault.configurePolicy(p);
        vm.prank(EXEC);
        vm.expectRevert();
        vault.executePayout(ID, 3, 0);
        p.version = 4;
        p.perPeriodCap = 5;
        p.lifetimeCap = 4;
        vault.configurePolicy(p);
        vm.prank(EXEC);
        vm.expectRevert();
        vault.executePayout(ID, 4, 0);
    }

    function testFullAllocationFloorAndWithdraw() public {
        vm.expectRevert();
        vault.setProtection(11, 10, bytes32(uint256(1)), 1000);
        vm.expectRevert();
        vault.withdrawUnallocated(PAYEE, 1);
        vault.release(ID, 5);
        vault.withdrawUnallocated(PAYEE, 5);
        require(token.balanceOf(address(vault)) == 45);
        vm.expectRevert();
        vault.allocate(ID, 1);
        vault.setProtection(5, 10, bytes32(uint256(1)), 1000);
        vault.allocate(ID, 5);
        token.burn(address(vault), 1);
        vm.expectRevert();
        pay(0);
    }

    function testGlobalBudgetNeverResetsOnReleaseOrUpdate() public {
        pay(0);
        vault.release(ID, 25);
        vm.expectRevert();
        vault.allocate(ID, 30);
        vault.allocate(ID, 25);
        require(vault.globalSpent() + vault.totalAllocated() == 30);
    }

    function testFalseOrShortTransferRollsBackAndReentryFails() public {
        token.mode(true, false, address(0), "");
        vm.expectRevert();
        pay(0);
        require(vault.globalSpent() == 0);
        token.mode(false, true, address(0), "");
        vm.expectRevert();
        pay(0);
        require(vault.allocation(ID) == 30);
        vault.setExecutor(address(token), true);
        token.mode(false, false, address(vault), abi.encodeCall(vault.executePayout, (ID, 1, 0)));
        pay(0);
        require(!token.callbackSucceeded());
        require(vault.globalSpent() == 5);
    }

    function testOnlyOwnerAndConfigurationValidation() public {
        vm.prank(EXEC);
        vm.expectRevert();
        vault.release(ID, 1);
        AutomationVault.Policy memory p = policy();
        p.version = 2;
        p.chainId = 0;
        vm.expectRevert();
        vault.configurePolicy(p);
        p.chainId = block.chainid;
        p.vault = address(1);
        vm.expectRevert();
        vault.configurePolicy(p);
        p.vault = address(vault);
        p.recipient = address(0);
        vm.expectRevert();
        vault.configurePolicy(p);
        p.recipient = PAYEE;
        p.amount = 0;
        vm.expectRevert();
        vault.configurePolicy(p);
        p.amount = 5;
        p.intervalSeconds = 0;
        vm.expectRevert();
        vault.configurePolicy(p);
        p.intervalSeconds = 10;
        p.endAt = p.startAt;
        vm.expectRevert();
        vault.configurePolicy(p);
        vm.expectRevert();
        vault.setProtection(0, 0, bytes32(0), 1000);
        vm.expectRevert();
        vault.setProtection(0, 0, bytes32(uint256(1)), 100);
    }

    function testIndependentPolicyHashFixture() public view {
        AutomationVault.Policy memory p = AutomationVault.Policy(
            31611,
            0x1111111111111111111111111111111111111111,
            bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222)),
            1,
            0x3333333333333333333333333333333333333333,
            5,
            100,
            1000,
            10,
            5,
            5,
            30,
            1,
            true
        );
        require(vault.hashPolicy(p) == 0xc451a09175afe64847e946ca3a0fa0130a3b4392929ebdbee1e26f5bb903b1b6);
    }

    function testFuzzRemainingAllocationConservesFloor(uint8 raw) public {
        uint256 runs = uint256(raw) % 7;
        for (uint256 i; i < runs; i++) {
            vm.warp(100 + i * 10);
            pay(i);
            require(token.balanceOf(address(vault)) >= vault.committedBills() + vault.buffer() + vault.totalAllocated());
            require(vault.globalSpent() + vault.totalAllocated() <= vault.globalBudget());
        }
        require(vault.globalSpent() == runs * 5);
        require(vault.allocation(ID) == 30 - runs * 5);
    }
}

contract AutomationHandler {
    VmAutomation constant vm = VmAutomation(address(uint160(uint256(keccak256("hevm cheat code")))));
    AutomationToken public token;
    AutomationVault public vault;
    uint256 public paid;
    uint256 public withdrawn;
    uint256 public period;
    bytes32 constant ID = bytes32(uint256(1));
    address constant PAYEE = address(0xbeef);

    constructor() {
        vm.warp(100);
        token = new AutomationToken();
        vault = new AutomationVault(address(token), address(this), 30);
        token.mint(address(vault), 50);
        vault.setExecutor(address(this), true);
        vault.setProtection(10, 10, bytes32(uint256(1)), type(uint256).max);
        vault.configurePolicy(
            AutomationVault.Policy(
                block.chainid, address(vault), ID, 1, PAYEE, 5, 100, type(uint256).max, 10, 5, 5, 30, 1, true
            )
        );
        vault.allocate(ID, 30);
    }

    function release(uint256 raw) external {
        uint256 a = vault.allocation(ID);
        if (a > 0) vault.release(ID, raw % a + 1);
    }

    function allocate(uint256 raw) external {
        uint256 available = token.balanceOf(address(vault)) - 20 - vault.totalAllocated();
        uint256 cap = 30 - vault.globalSpent() - vault.totalAllocated();
        if (cap < available) available = cap;
        if (available > 0) vault.allocate(ID, raw % available + 1);
    }

    function pay() external {
        if (vault.allocation(ID) < 5 || paid >= 30) return;
        vm.warp(100 + period * 10);
        vault.executePayout(ID, 1, period);
        period++;
        paid += 5;
    }

    function withdraw(uint256 raw) external {
        uint256 free = token.balanceOf(address(vault)) - 20 - vault.totalAllocated();
        if (free > 0) {
            uint256 n = raw % free + 1;
            vault.withdrawUnallocated(PAYEE, n);
            withdrawn += n;
        }
    }
}

contract AutomationVaultInvariantTest {
    AutomationHandler handler;

    function setUp() public {
        handler = new AutomationHandler();
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    fallback() external {
        assembly {
            mstore(0, 32)
            mstore(32, 0)
            return(0, 64)
        }
    }

    function invariantProtectsFloorBudgetAndConservation() public view {
        AutomationVault v = handler.vault();
        uint256 balance = handler.token().balanceOf(address(v));
        require(balance >= v.committedBills() + v.buffer() + v.totalAllocated());
        require(v.globalSpent() + v.totalAllocated() <= v.globalBudget());
        require(balance + handler.paid() + handler.withdrawn() == 50);
        require(v.allocation(bytes32(uint256(1))) == v.totalAllocated());
        require(v.lifetimeSpent(bytes32(uint256(1))) == v.globalSpent());
    }
}

