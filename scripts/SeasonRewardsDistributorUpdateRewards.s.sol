// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

// Scripting tool
import {Script} from "../lib/forge-std/src/Script.sol";

// Core contracts
import {SeasonRewardsDistributor} from "../contracts/SeasonRewardsDistributor.sol";

contract SeasonRewardsDistributorUpdateRewards is Script {
    error ChainIdInvalid(uint256 chainId);

    address public looksRareToken;
    address private owner;

    function run() external {
        uint256 chainId = block.chainid;
        uint256 ownerPrivateKey;

        if (chainId == 1) {
            ownerPrivateKey = vm.envUint("MAINNET_KEY");
        } else if (chainId == 5) {
            ownerPrivateKey = vm.envUint("TESTNET_KEY");
        } else {
            revert ChainIdInvalid(chainId);
        }

        vm.startBroadcast(ownerPrivateKey);

        SeasonRewardsDistributor distributor = SeasonRewardsDistributor(0x5C073CeCaFC56EE9f4335230A09933965C8ed472);
        distributor.initiateOwnershipTransfer(0xBfb6669Ef4C4c71ae6E722526B1B8d7d9ff9a019);
        // distributor.updateSeasonRewards(hex"164971bfe1b8d8c576321511317e6c25e2de27fac02001a5c1df7e6344d33652", 1e18);

        vm.stopBroadcast();
    }
}
