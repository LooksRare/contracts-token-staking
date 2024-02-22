// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {ProtocolFeesDistributor} from "../ProtocolFeesDistributor.sol";
import {IOwnableTwoSteps} from "@looksrare/contracts-libs/contracts/interfaces/IOwnableTwoSteps.sol";
import {Pausable} from "@looksrare/contracts-libs/contracts/Pausable.sol";

import {TestHelpers} from "./TestHelpers.sol";

abstract contract TestParameters {
    address internal constant BLAST = 0x4300000000000000000000000000000000000002;
    address internal constant WETH = 0x4200000000000000000000000000000000000023;
    address internal constant OWNER = address(888);
}

contract ProtocolFeesDistributorTest is TestParameters, TestHelpers {
    // ProtocolFeesDistributor protocolFeesDistributor;
    // event ProtocolFeesClaimed(address indexed user, uint256 indexed round, uint256 amount);
    // event ProtocolFeesDistributionUpdated(uint256 indexed round);
    // event EthWithdrawn(uint256 amount);
    // function setUp() public {
    //     protocolFeesDistributor = new ProtocolFeesDistributor(WETH, OWNER, BLAST);
    // }
    // function test_setUpState() public {
    //     assertTrue(protocolFeesDistributor.merkleRootUsed(bytes32(0)));
    // }
    // function test_claim() public {}
    // function test_claim_RevertIf_AlreadyClaimed() public {}
    // function test_claim_RevertIf_InvalidProof() public {}
    // function test_claim_RevertIf_AmountHigherThanMax() public {}
    // function test_updateProtocolFeesDistribution() public {}
    // function test_updateProtocolFeesDistribution_RevertIf_NotOwner() public {}
    // function test_updateProtocolFeesDistribution_RevertIf_MerkleRootAlreadyUsed() public {}
    // function test_pause() public asPrankedUser(OWNER) {
    //     protocolFeesDistributor.pause();
    //     assertTrue(protocolFeesDistributor.paused());
    // }
    // function test_pause_RevertIf_NotOwner() public {
    //     vm.expectRevert(IOwnableTwoSteps.NotOwner.selector);
    //     protocolFeesDistributor.pause();
    // }
    // function test_pause_RevertIf_Paused() public {}
    // function test_unpause() public asPrankedUser(OWNER) {
    //     protocolFeesDistributor.pause();
    //     protocolFeesDistributor.unpause();
    //     assertFalse(protocolFeesDistributor.paused());
    // }
    // function test_unpause_RevertIf_NotOwner() public {
    //     vm.expectRevert(IOwnableTwoSteps.NotOwner.selector);
    //     protocolFeesDistributor.unpause();
    // }
    // function test_unpause_RevertIf_Unpaused() public asPrankedUser(OWNER) {
    //     protocolFeesDistributor.pause();
    //     protocolFeesDistributor.unpause();
    //     vm.expectRevert(Pausable.NotPaused.selector);
    //     protocolFeesDistributor.unpause();
    // }
    // function test_withdrawETH() public asPrankedUser(OWNER) {
    //     vm.deal(address(protocolFeesDistributor), 10 ether);
    //     vm.expectEmit({checkTopic1: true, checkTopic2: true, checkTopic3: true, checkData: true});
    //     emit EthWithdrawn(10 ether);
    //     protocolFeesDistributor.withdrawETH(10 ether);
    //     assertEq(address(protocolFeesDistributor).balance, 0);
    //     assertEq(OWNER.balance, 10 ether);
    // }
    // function test_withdrawETH_RevertIf_NotOwner() public {
    //     vm.expectRevert(IOwnableTwoSteps.NotOwner.selector);
    //     protocolFeesDistributor.withdrawETH(10 ether);
    // }
    // function test_receive() public {
    //     vm.deal(user1, 10 ether);
    //     vm.prank(user1);
    //     (bool ok, ) = address(protocolFeesDistributor).call{value: 10 ether}("");
    //     assertTrue(ok);
    //     assertEq(address(protocolFeesDistributor).balance, 10 ether);
    //     assertEq(user1.balance, 0);
    // }
}
