// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MultiRewardsDistributor
 * @notice It distributes LOOKS tokens with multiple rolling Merkle airdrops.
 */
contract MultiRewardsDistributor is Pausable, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant BUFFER_ADMIN_WITHDRAW = 3 days;
    uint256 public constant DUMMY_AMOUNT = 1e18;

    IERC20 public immutable looksRareToken;

    struct TreeParameter {
        address dummyUser;
        bytes32 merkleRoot;
        uint256 maxAmountPerUserInCurrentTree;
    }

    // Keeps track of number of trees existing in parallel
    uint8 public numberTrees;

    // Current reward round
    uint256 public currentRewardRound;

    // Last paused timestamp
    uint256 public lastPausedTimestamp;

    // Keeps track of current parameters of a tree
    mapping(uint8 => TreeParameter) public treeParameters;

    // Total amount claimed by user (in LOOKS)
    mapping(address => mapping(uint8 => uint256)) public amountClaimedByUserPerTreeId;

    // Checks whether a merkle root was used
    mapping(bytes32 => bool) public merkleRootUsed;

    // Check whether dummy user was used
    mapping(address => bool) public dummyUserUsed;

    event Claim(address user, uint256 rewardRound, uint256 totalAmount, uint8[] treeIds, uint256[] amounts);
    event NewTree(uint8 treeId);
    event UpdateTradingRewards(uint256 indexed rewardRound);
    event TokenWithdrawnOwner(uint256 amount);

    /**
     * @notice Constructor
     * @param _looksRareToken address of the LooksRare token
     */
    constructor(address _looksRareToken) {
        looksRareToken = IERC20(_looksRareToken);
        _pause();
    }

    /**
     * @notice Claim pending rewards
     * @param treeIds array of treeIds
     * @param amounts array of amounts to claim
     * @param merkleProofs array of arrays containing the merkle proof
     */
    function claim(
        uint8[] calldata treeIds,
        uint256[] calldata amounts,
        bytes32[][] calldata merkleProofs
    ) external whenNotPaused nonReentrant {
        require(treeIds.length == amounts.length && merkleProofs.length == treeIds.length, "Rewards: Wrong lengths");

        uint256 amountToTransfer;
        uint256[] memory adjustedAmounts = new uint256[](amounts.length);

        for (uint256 i = 0; i < treeIds.length; i++) {
            require(treeIds[i] < numberTrees, "Rewards: Tree nonexistent");
            (bool claimStatus, uint256 adjustedAmount) = _canClaim(msg.sender, treeIds[i], amounts[i], merkleProofs[i]);
            require(claimStatus, "Rewards: Invalid proof");
            require(adjustedAmount > 0, "Rewards: Already claimed");
            require(
                amounts[i] <= treeParameters[treeIds[i]].maxAmountPerUserInCurrentTree,
                "Rewards: Amount higher than max"
            );
            amountToTransfer += adjustedAmount;
            amountClaimedByUserPerTreeId[msg.sender][treeIds[i]] += adjustedAmount;
            adjustedAmounts[i] = adjustedAmount;
        }

        // Transfer total amount
        looksRareToken.safeTransfer(msg.sender, amountToTransfer);

        emit Claim(msg.sender, currentRewardRound, amountToTransfer, treeIds, adjustedAmounts);
    }

    /**
     * @notice Update trading rewards with a new merkle root
     * @dev It automatically increments the currentRewardRound
     * @param treeIds array of treeIds
     * @param merkleRoots array of merkle roots (for each treeId)
     * @param maxAmountsPerUser array of maximum amounts per user (for each treeId)
     */
    function updateTradingRewards(
        uint8[] calldata treeIds,
        bytes32[] calldata merkleRoots,
        uint256[] calldata maxAmountsPerUser,
        bytes32[][] calldata merkleProofsDummyUser
    ) external onlyOwner {
        require(
            treeIds.length == merkleRoots.length &&
                merkleRoots.length == maxAmountsPerUser.length &&
                merkleRoots.length > 0,
            "Owner: Wrong lengths"
        );

        for (uint256 i = 0; i < merkleRoots.length; i++) {
            require(treeIds[i] < numberTrees, "Owner: Tree nonexistent");
            require(!merkleRootUsed[merkleRoots[i]], "Owner: Merkle root already used");
            treeParameters[treeIds[i]].merkleRoot = merkleRoots[i];
            treeParameters[treeIds[i]].maxAmountPerUserInCurrentTree = maxAmountsPerUser[i];
            merkleRootUsed[merkleRoots[i]] = true;
            _canClaim(treeParameters[treeIds[i]].dummyUser, treeIds[i], DUMMY_AMOUNT, merkleProofsDummyUser[i]);
        }

        // Increment reward round
        currentRewardRound++;

        emit UpdateTradingRewards(currentRewardRound);
    }

    /**
     * @notice Add a new tree
     * @param dummyUser address of a dummy user (e.g., address(0), address(1))
     * @dev Only for owner.
     */
    function addNewTree(address dummyUser) public onlyOwner {
        require(!dummyUserUsed[dummyUser], "Owner: Dummy user exists");
        treeParameters[numberTrees].dummyUser = dummyUser;
        numberTrees++;

        emit NewTree(numberTrees - 1);
    }

    /**
     * @notice Pause distribution
     * @dev Only for owner.
     */
    function pauseDistribution() external onlyOwner whenNotPaused {
        lastPausedTimestamp = block.timestamp;
        _pause();
    }

    /**
     * @notice Unpause distribution
     * @dev Only for owner.
     */
    function unpauseDistribution() external onlyOwner whenPaused {
        _unpause();
    }

    /**
     * @notice Transfer LOOKS tokens back to owner
     * @dev It is for emergency purposes. Only for owner.
     * @param amount amount to withdraw
     */
    function withdrawTokenRewards(uint256 amount) external onlyOwner whenPaused {
        require(block.timestamp > (lastPausedTimestamp + BUFFER_ADMIN_WITHDRAW), "Owner: Too early to withdraw");
        looksRareToken.safeTransfer(msg.sender, amount);

        emit TokenWithdrawnOwner(amount);
    }

    /**
     * @notice Check whether it is possible to claim and how much based on previous distribution
     * @param user address of the user
     * @param treeIds array of treeIds
     * @param amounts array of amounts to claim
     * @param merkleProofs array of arrays containing the merkle proof
     */
    function canClaim(
        address user,
        uint8[] calldata treeIds,
        uint256[] calldata amounts,
        bytes32[][] calldata merkleProofs
    ) external view returns (bool[] memory, uint256[] memory) {
        bool[] memory statuses = new bool[](amounts.length);
        uint256[] memory adjustedAmounts = new uint256[](amounts.length);

        if (treeIds.length != amounts.length || treeIds.length != merkleProofs.length || treeIds.length == 0) {
            return (statuses, adjustedAmounts);
        } else {
            for (uint256 i = 0; i < treeIds.length; i++) {
                if (treeIds[i] < numberTrees) {
                    (statuses[i], adjustedAmounts[i]) = _canClaim(user, treeIds[i], amounts[i], merkleProofs[i]);
                }
            }
            return (statuses, adjustedAmounts);
        }
    }

    /**
     * @notice Check whether it is possible to claim and how much based on previous distribution
     * @param user address of the user
     * @param treeId id of the merkle tree
     * @param amount amount to claim
     * @param merkleProof array with the merkle proof
     */
    function _canClaim(
        address user,
        uint8 treeId,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) internal view returns (bool, uint256) {
        // Compute the node and verify the merkle proof
        bytes32 node = keccak256(abi.encodePacked(user, amount));
        bool canUserClaim = MerkleProof.verify(merkleProof, treeParameters[treeId].merkleRoot, node);

        if (!canUserClaim) {
            return (false, 0);
        } else {
            uint256 adjustedAmount = amount - amountClaimedByUserPerTreeId[user][treeId];
            return (true, adjustedAmount);
        }
    }
}
