// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AutomationAccountV2} from "../src/AutomationAccountV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface VmBatchFork {
    function envOr(string calldata, string calldata) external returns (string memory);
    function envOr(string calldata, uint256) external returns (uint256);
    function createSelectFork(string calldata, uint256) external returns (uint256);
    function load(address, bytes32) external view returns (bytes32);
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function skip(bool) external;
}

interface IRealMusdBatch {
    function decimals() external view returns (uint8);
}

/// @notice Opt-in fork tests only. Prank moves existing MUSD on the local fork; no key,
/// broadcast, token mint, token storage override or live-chain mutation is used.
contract AutomationAccountV2ForkTest {
    VmBatchFork constant vm = VmBatchFork(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant BO_IMPL = 0xc05Bf344BD5b58825784326dD3112fB6cC160dcC;
    address constant TM_IMPL = 0x9aAB567966983e95536FC460C12266FB0Cc10B07;
    bytes32 constant MUSD_CODEHASH = 0xc0d0630dacd16463b0390f3914920cb4cbbe3586e7a51ef0d71930249756f474;
    address constant EXISTING_HOLDER = 0x8862e18aC653AC4123DBc0D12528cdBF5402dCe8;
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    address constant EXECUTOR = address(0xE100);
    address constant PAYEE_ONE = address(0xE101);
    address constant PAYEE_TWO = address(0xE102);
    bytes32 constant ID = keccak256("studio-kind-zero-fork-test");
    uint256 constant EACH = 0.01 ether;
    IERC20 token;
    AutomationAccountV2 account;
    bool forkEnabled;
    uint256 firstPayment;
    event log_named_uint(string key, uint256 val);

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        // Default is the explicit block independently read during the 2026-10-26 gate.
        uint256 atBlock = vm.envOr("MEZO_FORK_BLOCK", uint256(16377529));
        vm.createSelectFork(rpc, atBlock);
        forkEnabled = true;
        emit log_named_uint("Mezo fork block", block.number);
        require(block.chainid == 31611, "wrong fork chain");
        require(MUSD.code.length > 0 && BO.code.length > 0 && TM.code.length > 0, "missing deployment");
        require(keccak256(MUSD.code) == MUSD_CODEHASH, "MUSD code pin changed");
        require(address(uint160(uint256(vm.load(BO, IMPLEMENTATION_SLOT)))) == BO_IMPL, "BO pin changed");
        require(address(uint160(uint256(vm.load(TM, IMPLEMENTATION_SLOT)))) == TM_IMPL, "TM pin changed");
        require(BO_IMPL.code.length > 0 && TM_IMPL.code.length > 0, "missing implementation");
        require(IRealMusdBatch(MUSD).decimals() == 18, "unexpected token units");
        token = IERC20(MUSD);
        require(token.balanceOf(EXISTING_HOLDER) >= 2 ether, "fork holder lacks test MUSD");
        account = new AutomationAccountV2(MUSD, address(this), 10 ether, BO, TM);
        require(address(account.token()) == MUSD && account.owner() == address(this), "identity mismatch");
        require(address(account.operations()) == BO && address(account.troveManager()) == TM, "protocol mismatch");
        require(account.globalBudget() == 10 ether && account.deploymentChainId() == 31611, "limits mismatch");
        // This is a normal transfer executed by an impersonated funded holder ON THE LOCAL FORK.
        vm.prank(EXISTING_HOLDER);
        require(token.transfer(address(this), 2 ether), "real MUSD transfer failed");
        token.approve(address(account), 2 ether);
        account.depositCapital(2 ether);
        account.setExecutor(EXECUTOR, true);
        firstPayment = block.timestamp;
        account.setProtection(1 ether, 0.5 ether, keccak256("fork bills and reserve"), firstPayment + 3 days);
        _configure(false);
        account.allocate(ID, 4 * EACH, false);
    }

    modifier onFork() {
        vm.skip(!forkEnabled);
        _;
    }

    function _configure(bool duplicate) internal {
        address[] memory recipients = new address[](2);
        recipients[0] = PAYEE_ONE;
        recipients[1] = duplicate ? PAYEE_ONE : PAYEE_TWO;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = EACH;
        amounts[1] = EACH;
        account.configure(
            AutomationAccountV2.Policy(
                ID,
                duplicate ? 2 : 1,
                0,
                firstPayment,
                firstPayment + 3 days,
                1 days,
                2 * EACH,
                2 * EACH,
                4 * EACH,
                true
            ),
            recipients,
            amounts
        );
    }

    function testForkRealMusdBatchConservationAndReplay() public onFork {
        uint256 beforeOne = token.balanceOf(PAYEE_ONE);
        uint256 beforeTwo = token.balanceOf(PAYEE_TWO);
        uint256 beforeAccount = token.balanceOf(address(account));
        vm.prank(EXECUTOR);
        account.execute(ID, 1, 0, address(0), address(0));
        require(token.balanceOf(PAYEE_ONE) == beforeOne + EACH, "first transfer mismatch");
        require(token.balanceOf(PAYEE_TWO) == beforeTwo + EACH, "second transfer mismatch");
        require(token.balanceOf(address(account)) == beforeAccount - 2 * EACH, "batch debit mismatch");
        require(account.globalSpent() == 2 * EACH && account.lifetimeSpent(ID) == 2 * EACH, "spend mismatch");
        require(account.allocation(ID) == 2 * EACH && account.periodConsumed(ID, 0), "journal mismatch");
        require(
            token.balanceOf(address(account))
                == account.capitalFree() + account.revenueFree() + account.totalAllocated() + account.unclassified(),
            "conservation mismatch"
        );
        vm.expectRevert(AutomationAccountV2.Invalid.selector);
        vm.prank(EXECUTOR);
        account.execute(ID, 1, 0, address(0), address(0));
        require(token.balanceOf(address(account)) == beforeAccount - 2 * EACH, "replay moved funds");
    }

    function testForkBillsAndCashReserveRemainProtected() public onFork {
        uint256 beforeAccount = token.balanceOf(address(account));
        vm.expectRevert(AutomationAccountV2.Floor.selector);
        account.setProtection(2 ether, 0, keccak256("too much protected"), firstPayment + 3 days);
        require(account.committed() == 1 ether && account.buffer() == 0.5 ether, "floor update not atomic");
        require(token.balanceOf(address(account)) == beforeAccount, "floor check moved funds");
        vm.prank(EXECUTOR);
        account.execute(ID, 1, 0, address(0), address(0));
        require(account.capitalFree() >= account.committed() + account.buffer(), "protected cash spent");
    }

    function testForkDuplicatePayeeRejectedWithoutChangingApprovedBatch() public onFork {
        vm.expectRevert(AutomationAccountV2.Invalid.selector);
        _configure(true);
        (address[] memory recipients, uint256[] memory amounts) = account.payeesOf(ID);
        require(recipients.length == 2 && recipients[1] == PAYEE_TWO && amounts[0] == EACH, "batch changed");
        require(account.policyOf(ID).version == 1, "version changed");
    }

    function testForkRevokedBatchCannotRunNextWindow() public onFork {
        account.revoke(ID);
        vm.warp(firstPayment + 1 days);
        uint256 beforeAccount = token.balanceOf(address(account));
        vm.expectRevert(AutomationAccountV2.Invalid.selector);
        vm.prank(EXECUTOR);
        account.execute(ID, 1, 1, address(0), address(0));
        require(
            token.balanceOf(address(account)) == beforeAccount && account.globalSpent() == 0, "revocation moved funds"
        );
    }

    function testForkExecutorCannotEscapeIntoTokenApproval() public onFork {
        vm.prank(EXECUTOR);
        (bool ok,) = address(account).call(abi.encodeWithSignature("approve(address,uint256)", EXECUTOR, 1 ether));
        require(!ok, "unexpected arbitrary token approval entrypoint");
        require(token.allowance(address(account), EXECUTOR) == 0, "executor allowance created");
        vm.expectRevert(AutomationAccountV2.Unauthorized.selector);
        vm.prank(EXECUTOR);
        account.withdrawFree(EXECUTOR, EACH);
    }
}
