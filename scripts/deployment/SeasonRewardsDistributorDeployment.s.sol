// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

// Scripting tool
import {Script} from "../../lib/forge-std/src/Script.sol";

// Core contracts
import {SeasonRewardsDistributor} from "../../contracts/SeasonRewardsDistributor.sol";

contract SeasonRewardsDistributorDeployment is Script {
    error ChainIdInvalid(uint256 chainId);

    address public looksRareToken;
    address private owner;

    function run() external {
        uint256 chainId = block.chainid;
        uint256 deployerPrivateKey;

        if (chainId == 1) {
            looksRareToken = 0xf4d2888d29d722226fafa5d9b24f9164c092421e;
            owner = 0xBfb6669Ef4C4c71ae6E722526B1B8d7d9ff9a019;
            deployerPrivateKey = vm.envUint("MAINNET_KEY");
        } else if (chainId == 5) {
            looksRareToken = 0x20A5A36ded0E4101C3688CBC405bBAAE58fE9eeC;
            owner = 0xF332533bF5d0aC462DC8511067A8122b4DcE2B57;
            deployerPrivateKey = vm.envUint("TESTNET_KEY");
        } else {
            revert ChainIdInvalid(chainId);
        }

        vm.startBroadcast(deployerPrivateKey);

        new SeasonRewardsDistributor(looksRareToken, owner);

        vm.stopBroadcast();
    }
}
