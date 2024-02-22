// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {LowLevelWETH} from "@looksrare/contracts-libs/contracts/lowLevelCallers/LowLevelWETH.sol";
import {OwnableTwoSteps} from "@looksrare/contracts-libs/contracts/OwnableTwoSteps.sol";
import {Pausable} from "@looksrare/contracts-libs/contracts/Pausable.sol";
import {ReentrancyGuard} from "@looksrare/contracts-libs/contracts/ReentrancyGuard.sol";

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {IBlast, GasMode, YieldMode} from "./interfaces/IBlast.sol";

/**
 * @title ProtocolFeesDistributor
 * @notice It distributes protocol fees with rolling Merkle airdrops.
 */
contract ProtocolFeesDistributor is Pausable, ReentrancyGuard, OwnableTwoSteps, LowLevelWETH {
    address private immutable WETH;

    // Current round (users can only claim pending protocol fees for the current round)
    uint256 public currentRound;

    // Max amount per user in current tree
    uint256 public maximumAmountPerUserInCurrentTree;

    // Total amount claimed by user (in ETH)
    mapping(address => uint256) public amountClaimedByUser;

    // Merkle root for a round
    mapping(uint256 => bytes32) public merkleRootOfRound;

    // Checks whether a merkle root was used
    mapping(bytes32 => bool) public merkleRootUsed;

    // Keeps track on whether user has claimed at a given round
    mapping(uint256 => mapping(address => bool)) public hasUserClaimedForRound;

    event ProtocolFeesClaimed(address indexed user, uint256 indexed round, uint256 amount);
    event ProtocolFeesDistributionUpdated(uint256 indexed round);
    event EthWithdrawn(uint256 amount);

    error AlreadyClaimed();
    error AmountHigherThanMax();
    error InvalidProof();
    error MerkleRootAlreadyUsed();

    /**
     * @notice Constructor
     * @param _weth address of the WETH token
     * @param _owner address of the owner
     * @param _blast address of the BLAST precompile
     */
    constructor(
        address _weth,
        address _owner,
        address _blast
    ) OwnableTwoSteps(_owner) {
        WETH = _weth;
        merkleRootUsed[bytes32(0)] = true;

        IBlast(_blast).configure(YieldMode.CLAIMABLE, GasMode.CLAIMABLE, _owner);
    }

    /**
     * @notice Claim pending protocol fees
     * @param amount amount to claim
     * @param merkleProof array containing the merkle proof
     */
    function claim(uint256 amount, bytes32[] calldata merkleProof) external whenNotPaused nonReentrant {
        // Verify the round is not claimed already
        if (hasUserClaimedForRound[currentRound][msg.sender]) {
            revert AlreadyClaimed();
        }

        (bool claimStatus, uint256 adjustedAmount) = _canClaim(msg.sender, amount, merkleProof);

        if (!claimStatus) {
            revert InvalidProof();
        }
        if (amount > maximumAmountPerUserInCurrentTree) {
            revert AmountHigherThanMax();
        }

        // Set mapping for user and round as true
        hasUserClaimedForRound[currentRound][msg.sender] = true;

        // Adjust amount claimed
        amountClaimedByUser[msg.sender] += adjustedAmount;

        // Transfer adjusted amount
        _transferETHAndWrapIfFailWithGasLimit({
            _WETH: WETH,
            _to: msg.sender,
            _amount: adjustedAmount,
            _gasLimit: gasleft()
        });

        emit ProtocolFeesClaimed(msg.sender, currentRound, adjustedAmount);
    }

    /**
     * @notice Update protocol fees distribution with a new merkle root
     * @dev It automatically increments the currentRound
     * @param merkleRoot root of the computed merkle tree
     */
    function updateProtocolFeesDistribution(bytes32 merkleRoot, uint256 newMaximumAmountPerUser)
        external
        payable
        onlyOwner
    {
        if (merkleRootUsed[merkleRoot]) {
            revert MerkleRootAlreadyUsed();
        }

        currentRound++;
        merkleRootOfRound[currentRound] = merkleRoot;
        merkleRootUsed[merkleRoot] = true;
        maximumAmountPerUserInCurrentTree = newMaximumAmountPerUser;

        emit ProtocolFeesDistributionUpdated(currentRound);
    }

    /**
     * @notice Pause claim
     */
    function pause() external onlyOwner whenNotPaused {
        _pause();
    }

    /**
     * @notice Unpause claim
     */
    function unpause() external onlyOwner whenPaused {
        _unpause();
    }

    /**
     * @notice Transfer ETH back to owner
     * @dev It is for emergency purposes
     * @param amount amount to withdraw
     */
    function withdrawETH(uint256 amount) external onlyOwner {
        _transferETHAndWrapIfFailWithGasLimit({_WETH: WETH, _to: msg.sender, _amount: amount, _gasLimit: gasleft()});
        emit EthWithdrawn(amount);
    }

    /**
     * @notice Check whether it is possible to claim and how much based on previous distribution
     * @param user address of the user
     * @param amount amount to claim
     * @param merkleProof array with the merkle proof
     */
    function canClaim(
        address user,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external view returns (bool, uint256) {
        return _canClaim(user, amount, merkleProof);
    }

    /**
     * @notice Check whether it is possible to claim and how much based on previous distribution
     * @param user address of the user
     * @param amount amount to claim
     * @param merkleProof array with the merkle proof
     */
    function _canClaim(
        address user,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) internal view returns (bool, uint256) {
        // Compute the node and verify the merkle proof
        bytes32 node = keccak256(bytes.concat(keccak256(abi.encodePacked(user, amount))));

        bool canUserClaim = MerkleProof.verify(merkleProof, merkleRootOfRound[currentRound], node);

        if ((!canUserClaim) || (hasUserClaimedForRound[currentRound][user])) {
            return (false, 0);
        } else {
            return (true, amount - amountClaimedByUser[user]);
        }
    }

    receive() external payable {}
}
