// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {LowLevelWETH} from "@looksrare/contracts-libs/contracts/lowLevelCallers/LowLevelWETH.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@looksrare/contracts-libs/contracts/Pausable.sol";
import {ReentrancyGuard} from "@looksrare/contracts-libs/contracts/ReentrancyGuard.sol";

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {IBlast, GasMode, YieldMode} from "./interfaces/IBlast.sol";
import {IBlastPoints} from "./interfaces/IBlastPoints.sol";

/**
 * @title ProtocolFeesDistributor
 * @notice It distributes protocol fees with rolling Merkle airdrops.
 * @author YOLO Games Team
 */
contract ProtocolFeesDistributor is Pausable, ReentrancyGuard, AccessControl, LowLevelWETH {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    address private immutable WETH;

    // Current round (users can only claim pending protocol fees for the current round)
    uint256 public currentRound;

    // Users can claim until this timestamp
    uint256 public canClaimUntil;

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
    event CanClaimUntilUpdated(uint256 timestamp);

    error AlreadyClaimed();
    error AmountHigherThanMax();
    error ClaimPeriodEnded();
    error InvalidProof();
    error MerkleRootAlreadyUsed();

    /**
     * @notice Constructor
     * @param _weth address of the WETH token
     * @param _owner address of the owner
     * @param _operator address of the operator
     * @param _blast address of the BLAST precompile
     * @param _blastPoints The Blast points configuration.
     * @param _blastPointsOperator The Blast points operator.
     */
    constructor(
        address _weth,
        address _owner,
        address _operator,
        address _blast,
        address _blastPoints,
        address _blastPointsOperator
    ) {
        WETH = _weth;
        merkleRootUsed[bytes32(0)] = true;

        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(OPERATOR_ROLE, _owner);
        _grantRole(OPERATOR_ROLE, _operator);

        IBlast(_blast).configure(YieldMode.CLAIMABLE, GasMode.CLAIMABLE, _owner);
        IBlastPoints(_blastPoints).configurePointsOperator(_blastPointsOperator);
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

        if (block.timestamp > canClaimUntil) {
            revert ClaimPeriodEnded();
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
        onlyRole(OPERATOR_ROLE)
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

    function updateCanClaimUntil(uint256 timestamp) external onlyRole(OPERATOR_ROLE) {
        canClaimUntil = timestamp;
        emit CanClaimUntilUpdated(timestamp);
    }

    /**
     * @notice Pause claim
     */
    function pause() external onlyRole(OPERATOR_ROLE) whenNotPaused {
        _pause();
    }

    /**
     * @notice Unpause claim
     */
    function unpause() external onlyRole(OPERATOR_ROLE) whenPaused {
        _unpause();
    }

    /**
     * @notice Transfer ETH back to owner
     * @dev It is for emergency purposes
     * @param amount amount to withdraw
     */
    function withdrawETH(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
        if (block.timestamp > canClaimUntil) {
            return (false, 0);
        }

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
        bytes32 node = keccak256(bytes.concat(keccak256(abi.encode(user, amount))));

        bool canUserClaim = MerkleProof.verify(merkleProof, merkleRootOfRound[currentRound], node);

        if ((!canUserClaim) || (hasUserClaimedForRound[currentRound][user])) {
            return (false, 0);
        } else {
            return (true, amount - amountClaimedByUser[user]);
        }
    }

    receive() external payable {}
}
