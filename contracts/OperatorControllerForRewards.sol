// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {FeeSharingSetter} from "./FeeSharingSetter.sol";
import {TokenSplitter} from "./TokenSplitter.sol";

/**
 * @title OperatorControllerForRewards
 * @notice It splits pending LOOKS and updates trading rewards.
 */
contract OperatorControllerForRewards is Ownable {
    TokenSplitter public immutable tokenSplitter;
    FeeSharingSetter public immutable feeSharingSetter;

    address public immutable teamVesting;
    address public immutable treasuryVesting;
    address public immutable tradingRewardsDistributor;

    /**
     * @notice Constructor
     * @param _feeSharingSetter address of the fee sharing setter contract
     * @param _tokenSplitter address of the token splitter contract
     * @param _teamVesting address of the team vesting contract
     * @param _treasuryVesting address of the treasury vesting contract
     * @param _tradingRewardsDistributor address of the trading rewards distributor contract
     */
    constructor(
        address _feeSharingSetter,
        address _tokenSplitter,
        address _teamVesting,
        address _treasuryVesting,
        address _tradingRewardsDistributor
    ) {
        feeSharingSetter = FeeSharingSetter(_feeSharingSetter);
        tokenSplitter = TokenSplitter(_tokenSplitter);
        teamVesting = _teamVesting;
        treasuryVesting = _treasuryVesting;
        tradingRewardsDistributor = _tradingRewardsDistributor;
    }

    /**
     * @notice Release LOOKS tokens from the TokenSplitter and update fee-sharing rewards
     */
    function releaseTokensAndUpdateRewards() external onlyOwner {
        try tokenSplitter.releaseTokens(teamVesting) {} catch {}
        try tokenSplitter.releaseTokens(treasuryVesting) {} catch {}
        try tokenSplitter.releaseTokens(tradingRewardsDistributor) {} catch {}

        feeSharingSetter.updateRewards();
    }
}
