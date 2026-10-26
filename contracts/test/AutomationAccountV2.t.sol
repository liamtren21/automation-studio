// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {AutomationAccountV2} from "../src/AutomationAccountV2.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface VmV2 {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function deal(address, uint256) external;
}

contract V2Token is ERC20 {
    address public failTo;
    bool public fail;
    bool public steal;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes public callbackResult;
    uint256 public callbackAttempts;
    constructor() ERC20("V2 Test MUSD", "MUSD") {}

    function mint(address r, uint256 n) external {
        _mint(r, n);
    }

    function burn(address r, uint256 n) external {
        _burn(r, n);
    }

    function setFailTo(address r) external {
        failTo = r;
    }

    function mode(bool f, bool s, address target, bytes calldata data) external {
        fail = f;
        steal = s;
        callbackTarget = target;
        callbackData = data;
    }

    function transfer(address to, uint256 n) public override returns (bool) {
        if (fail || to == failTo) return false;
        if (callbackTarget != address(0)) {
            callbackAttempts++;
            (callbackSucceeded,callbackResult) = callbackTarget.call(callbackData);
        }
        return super.transfer(to, steal ? n - 1 : n);
    }
}

contract ProtocolV2Mock {
    V2Token public token;
    uint256 public minNetDebt = 20;
    uint256 public MUSD_GAS_COMPENSATION = 5;
    mapping(address => uint256) public principal;
    mapping(address => uint256) public interest;
    mapping(address => uint256) public collateral;

    constructor(V2Token t) {
        token = t;
    }

    function seed(address a, uint256 p, uint256 i) external {
        principal[a] = p;
        interest[a] = i;
        collateral[a] = 100;
    }

    function setMinimum(uint256 m) external {
        minNetDebt = m;
    }

    function getTroveStatus(address a) external view returns (uint8) {
        return principal[a] > 0 ? 1 : 0;
    }

    function getEntireDebtAndColl(address a)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (collateral[a], principal[a], interest[a], 7, 8, 9);
    }

    function repayMUSD(uint256 n, address, address) external {
        token.burn(msg.sender, n);
        uint256 i = interest[msg.sender];
        if (n >= i) {
            interest[msg.sender] = 0;
            principal[msg.sender] -= n - i;
        } else {
            interest[msg.sender] -= n;
        }
    }

    function openTrove(uint256 n, address, address) external payable {
        principal[msg.sender] = n + 5;
        collateral[msg.sender] = msg.value;
        token.mint(msg.sender, n);
    }

    function addColl(address, address) external payable {
        collateral[msg.sender] += msg.value;
    }

    function closeTrove() external {
        token.burn(msg.sender, principal[msg.sender] + interest[msg.sender] - 5);
        principal[msg.sender] = 0;
        interest[msg.sender] = 0;
    }
    function claimCollateral() external {}
}

contract AutomationAccountV2Test {
    VmV2 constant vm = VmV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    V2Token t;
    ProtocolV2Mock protocol;
    AutomationAccountV2 a;
    address constant EXEC = address(11);
    address constant P = address(12);
    address constant Q = address(13);
    bytes32 constant ID = bytes32(uint256(1));

    function setUp() public {
        vm.warp(100);
        t = new V2Token();
        protocol = new ProtocolV2Mock(t);
        a = new AutomationAccountV2(address(t), address(this), 1000, address(protocol), address(protocol));
        t.mint(address(this), 1000);
        t.approve(address(a), 1000);
        a.depositCapital(500);
        a.setExecutor(EXEC, true);
        a.setProtection(10, 10, bytes32(uint256(1)), 1000);
    }

    function config(uint8 kind) internal {
        address[] memory ps = new address[](kind == 2 ? 0 : 2);
        uint256[] memory ns = new uint256[](kind == 2 ? 1 : 2);
        if (kind == 2) {
            ns[0] = 10;
        } else {
            ps[0] = P;
            ps[1] = Q;
            ns[0] = kind == 1 ? 6000 : 6;
            ns[1] = kind == 1 ? 3000 : 4;
        }
        a.configure(AutomationAccountV2.Policy(ID, 1, kind, 100, 1000, 10, 100, 100, 500, true), ps, ns);
    }

    function execute() internal {
        vm.prank(EXEC);
        a.execute(ID, 1, 0, address(0), address(0));
    }

    function testBatchAggregateAndReplay() public {
        config(0);
        a.allocate(ID, 20, false);
        execute();
        require(t.balanceOf(P) == 6 && t.balanceOf(Q) == 4);
        require(a.globalSpent() == 10 && a.totalAllocated() == 10);
        vm.expectRevert();
        execute();
    }

    function testAuthorizedTokenCallbackCannotExecuteOtherPolicy() public {
        config(0);
        a.allocate(ID, 30, false);
        bytes32 other = keccak256("another approved payment");
        address[] memory ps = new address[](2);
        ps[0] = P;
        ps[1] = Q;
        uint256[] memory ns = new uint256[](2);
        ns[0] = 6;
        ns[1] = 4;
        a.configure(AutomationAccountV2.Policy(other, 1, 0, 100, 1000, 10, 100, 100, 500, true), ps, ns);
        a.allocate(other, 10, false);
        // Give the hostile token executor scope so authorization cannot mask a reentrancy failure.
        a.setExecutor(address(t), true);
        t.mode(false, false, address(a), abi.encodeCall(a.execute, (other, 1, 0, address(0), address(0))));
        execute();
        require(t.callbackAttempts() == 2 && !t.callbackSucceeded());
        require(bytes4(t.callbackResult()) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        require(t.balanceOf(P) == 6 && t.balanceOf(Q) == 4);
        require(a.globalSpent() == 10 && a.totalAllocated() == 30);
        require(a.periodConsumed(ID, 0) && !a.periodConsumed(other, 0));
    }

    function testSplitExplicitRevenueDustAndProspectiveWeights() public {
        config(1);
        a.depositRevenue(ID, 11);
        require(a.allocation(ID) == 9 && a.revenueFree() == 2);
        execute();
        require(t.balanceOf(P) == 6 && t.balanceOf(Q) == 3);
        require(a.globalSpent() == 9);
    }

    function testDirectAndBorrowedFundsNeverRevenue() public {
        t.mint(address(a), 20);
        require(a.unclassified() == 20 && a.revenueFree() == 0);
        vm.deal(address(this), 1 ether);
        a.openLoan{value: 1}(50, address(0), address(0));
        require(a.capitalFree() == 550 && a.revenueFree() == 0);
    }

    function testAtomicRollback() public {
        config(0);
        a.allocate(ID, 20, false);
        t.mode(true, false, address(0), "");
        vm.expectRevert();
        execute();
        require(a.globalSpent() == 0 && a.allocation(ID) == 20 && !a.periodConsumed(ID, 0));
    }

    function testExactDeltaRollback() public {
        config(0);
        a.allocate(ID, 20, false);
        t.mode(false, true, address(0), "");
        vm.expectRevert();
        execute();
        require(t.balanceOf(P) == 0 && a.globalSpent() == 0);
    }

    function testRepaymentInterestAndInclusiveDebtIdentity() public {
        config(2);
        protocol.seed(address(a), 50, 10);
        a.allocate(ID, 10, false);
        execute();
        require(protocol.principal(address(a)) == 50 && protocol.interest(address(a)) == 0);
        require(a.globalSpent() == 10);
    }

    function testDynamicMinimumDebt() public {
        config(2);
        protocol.seed(address(a), 30, 0);
        a.allocate(ID, 10, false);
        protocol.setMinimum(25);
        vm.expectRevert();
        execute();
        require(a.globalSpent() == 0);
    }

    function testExpiredRevokedPausedUnauthorized() public {
        config(0);
        a.allocate(ID, 20, false);
        a.pause();
        vm.expectRevert();
        execute();
        a.unpause();
        a.revoke(ID);
        vm.expectRevert();
        execute();
    }

    function testProtectionFloorAndConservation() public {
        config(0);
        vm.expectRevert();
        a.allocate(ID, 490, false);
        a.allocate(ID, 30, false);
        execute();
        require(t.balanceOf(address(a)) == a.capitalFree() + a.revenueFree() + a.totalAllocated() + a.unclassified());
    }

    function testDuplicatePayeesRejected() public {
        address[] memory ps = new address[](2);
        ps[0] = P;
        ps[1] = P;
        uint256[] memory ns = new uint256[](2);
        ns[0] = 1;
        ns[1] = 1;
        vm.expectRevert();
        a.configure(AutomationAccountV2.Policy(ID, 1, 0, 100, 1000, 10, 100, 100, 500, true), ps, ns);
    }

    function testVersionUpdateCannotReplayOrMoveGrid() public {
        config(0);
        a.allocate(ID, 30, false);
        execute();
        (address[] memory ps, uint256[] memory ns) = a.payeesOf(ID);
        AutomationAccountV2.Policy memory p = a.policyOf(ID);
        p.version = 2;
        a.configure(p, ps, ns);
        vm.expectRevert();
        vm.prank(EXEC);
        a.execute(ID, 2, 0, address(0), address(0));
        p.version = 3;
        p.startAt = 101;
        vm.expectRevert();
        a.configure(p, ps, ns);
    }

    function testSplitWeightUpdatePreservesExistingCredits() public {
        config(1);
        a.depositRevenue(ID, 100);
        (address[] memory ps, uint256[] memory ns) = a.payeesOf(ID);
        AutomationAccountV2.Policy memory p = a.policyOf(ID);
        p.version = 2;
        ns[0] = 2000;
        ns[1] = 8000;
        a.configure(p, ps, ns);
        a.depositRevenue(ID, 10);
        require(a.splitCredit(ID, P) == 62 && a.splitCredit(ID, Q) == 38);
        vm.prank(EXEC);
        a.execute(ID, 2, 0, address(0), address(0));
        require(t.balanceOf(P) == 62 && t.balanceOf(Q) == 38 && a.revenueFree() == 10);
    }

    function testAggregateRunCapNotPerPayee() public {
        config(0);
        (address[] memory ps, uint256[] memory ns) = a.payeesOf(ID);
        AutomationAccountV2.Policy memory p = a.policyOf(ID);
        p.version = 2;
        p.runCap = 9;
        a.configure(p, ps, ns);
        a.allocate(ID, 20, false);
        vm.expectRevert();
        vm.prank(EXEC);
        a.execute(ID, 2, 0, address(0), address(0));
        require(a.globalSpent() == 0);
    }

    function testExpiryAndStaleProtection() public {
        config(0);
        a.allocate(ID, 20, false);
        vm.warp(1000);
        vm.expectRevert();
        vm.prank(EXEC);
        a.execute(ID, 1, 90, address(0), address(0));
    }

    function testUnauthorizedOwnerAndExecutorScopes() public {
        config(0);
        a.allocate(ID, 20, false);
        vm.expectRevert();
        a.execute(ID, 1, 0, address(0), address(0));
        vm.expectRevert();
        vm.prank(EXEC);
        a.withdrawFree(P, 1);
        vm.expectRevert();
        vm.prank(EXEC);
        a.openLoan(50, address(0), address(0));
        vm.expectRevert();
        vm.prank(EXEC);
        a.depositRevenue(ID, 1);
    }

    function testWithdrawPreservesAllocationsAndRiskFloor() public {
        config(0);
        a.allocate(ID, 100, false);
        vm.expectRevert();
        a.withdrawFree(P, 381);
        a.withdrawFree(P, 380);
        require(t.balanceOf(address(a)) == 120 && a.totalAllocated() == 100);
    }

    function testNativeRecoveryOwnerOnly() public {
        vm.deal(address(a), 20);
        vm.expectRevert();
        vm.prank(EXEC);
        a.recoverNative(payable(P), 10);
        a.recoverNative(payable(P), 10);
        require(P.balance == 10 && address(a).balance == 10);
    }

    function testRepayDoesNotUseOwnerWalletDebt() public {
        config(2);
        protocol.seed(address(this), 100, 0);
        a.allocate(ID, 10, false);
        vm.expectRevert();
        execute();
        require(protocol.principal(address(this)) == 100 && a.globalSpent() == 0);
    }

    function testLifetimeCapSurvivesVersionChanges() public {
        config(0);
        (address[] memory ps, uint256[] memory ns) = a.payeesOf(ID);
        AutomationAccountV2.Policy memory p = a.policyOf(ID);
        p.version = 2;
        p.lifetimeCap = 10;
        a.configure(p, ps, ns);
        a.allocate(ID, 30, false);
        vm.prank(EXEC);
        a.execute(ID, 2, 0, address(0), address(0));
        vm.warp(110);
        vm.expectRevert();
        vm.prank(EXEC);
        a.execute(ID, 2, 1, address(0), address(0));
    }

    function testMaximumPayees() public {
        address[] memory ps = new address[](21);
        uint256[] memory ns = new uint256[](21);
        for (uint256 i; i < 21; i++) {
            ps[i] = address(uint160(100 + i));
            ns[i] = 1;
        }
        vm.expectRevert();
        a.configure(AutomationAccountV2.Policy(ID, 1, 0, 100, 1000, 10, 100, 100, 500, true), ps, ns);
    }

    function testFuzzSplitConservation(uint96 n) public {
        config(1);
        uint256 amount = uint256(n) % 200 + 1;
        a.depositRevenue(ID, amount);
        require(a.allocation(ID) == amount * 6000 / 10000 + amount * 3000 / 10000);
        require(a.capitalFree() + a.revenueFree() + a.totalAllocated() + a.unclassified() == t.balanceOf(address(a)));
    }

    function testSecondTransferFailureRollsBackFirstTransferAndLedger() public {
        config(0);
        a.allocate(ID, 20, false);
        t.setFailTo(Q);
        vm.expectRevert();
        execute();
        require(t.balanceOf(P) == 0 && t.balanceOf(Q) == 0 && a.globalSpent() == 0 && a.allocation(ID) == 20);
    }

    function testOwnerReleaseOfRevokedSplitPreservesConservation() public {
        config(1);
        a.depositRevenue(ID, 100);
        a.revoke(ID);
        a.releaseSplit(ID, P, 60);
        require(a.splitCredit(ID, P) == 0 && a.allocation(ID) == 30 && a.revenueFree() == 70);
        require(a.capitalFree() + a.revenueFree() + a.totalAllocated() + a.unclassified() == t.balanceOf(address(a)));
    }

    function testSharedGlobalCapAcrossPolicyKindsAndReleases() public {
        a = new AutomationAccountV2(address(t), address(this), 25, address(protocol), address(protocol));
        t.approve(address(a), 500);
        a.depositCapital(100);
        a.setExecutor(EXEC, true);
        a.setProtection(0, 0, bytes32(uint256(1)), 1000);
        config(0);
        a.allocate(ID, 20, false);
        execute();
        a.release(ID, 10);
        a.allocate(ID, 15, false);
        bytes32 splitId = bytes32(uint256(2));
        address[] memory ps = new address[](1);
        ps[0] = P;
        uint256[] memory ns = new uint256[](1);
        ns[0] = 10000;
        a.configure(AutomationAccountV2.Policy(splitId, 1, 1, 100, 1000, 10, 100, 100, 100, true), ps, ns);
        vm.expectRevert();
        a.depositRevenue(splitId, 1);
        require(a.globalSpent() == 10 && a.totalAllocated() == 15 && a.allocation(splitId) == 0);
    }

    function testProtocolCloseCannotConsumeProtectedAllocation() public {
        config(0);
        a.allocate(ID, 480, false);
        protocol.seed(address(a), 30, 0);
        vm.expectRevert();
        a.closeLoan();
        require(protocol.principal(address(a)) == 30 && a.totalAllocated() == 480);
    }

    function testChangedChainCannotExecutePolicy() public {
        config(0);
        a.allocate(ID, 20, false);
        vm.chainId(block.chainid + 1);
        vm.expectRevert();
        execute();
    }
}

