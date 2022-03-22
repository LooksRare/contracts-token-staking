// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import {DSTest} from "../../lib/ds-test/src/test.sol";

import {LooksRareToken} from "../LooksRareToken.sol";
import {TokenDistributor} from "../TokenDistributor.sol";
import {FeeSharingSystem} from "../FeeSharingSystem.sol";
import {AggregatorFeeSharingWithUniswapV3} from "../AggregatorFeeSharingWithUniswapV3.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {MockUniswapV3Router} from "./utils/MockUniswapV3Router.sol";

import {TestHelpers} from "./TestHelpers.sol";

abstract contract TestParameters {
    address internal _PREMINT_RECEIVER = address(42);
    address internal _TOKEN_SPLITTER = address(88);
    uint256 internal _CAP = 25000;
    uint256 internal _PREMINT_AMOUNT = 6250;
    uint256 internal _START_BLOCK;
}

contract AggregatorTest is DSTest, TestParameters, TestHelpers {
    LooksRareToken public looksRareToken;
    TokenDistributor public tokenDistributor;
    FeeSharingSystem public feeSharingSystem;
    AggregatorFeeSharingWithUniswapV3 public aggregatorFeeSharingWithUniswapV3;
    MockUniswapV3Router public uniswapRouter;
    MockERC20 public rewardToken;

    function setUp() public {
        // 0. Mock WETH
        rewardToken = new MockERC20("WETH", "Wrapped Ether");

        // 1. Mock Uniswap v3 Router
        uniswapRouter = new MockUniswapV3Router();

        // 2. LooksRareToken deployment
        looksRareToken = new LooksRareToken(_PREMINT_RECEIVER, _parseEther(_PREMINT_AMOUNT), _parseEther(_CAP));

        // 3. TokenDistributor deployment
        uint256[] memory rewardsPerBlockForStaking = new uint256[](4);
        rewardsPerBlockForStaking[0] = _parseEther(30);
        rewardsPerBlockForStaking[1] = _parseEther(15);
        rewardsPerBlockForStaking[2] = _parseEtherWithFloating(75, 1); // 7.5
        rewardsPerBlockForStaking[3] = _parseEtherWithFloating(375, 2); // 3.75

        uint256[] memory rewardsPerBlockForOthers = new uint256[](4);
        rewardsPerBlockForOthers[0] = _parseEther(70);
        rewardsPerBlockForOthers[1] = _parseEther(35);
        rewardsPerBlockForOthers[2] = _parseEtherWithFloating(175, 1); // 17.5
        rewardsPerBlockForOthers[3] = _parseEtherWithFloating(875, 2); // 8.75

        uint256[] memory periodLengthesInBlocks = new uint256[](4);
        periodLengthesInBlocks[0] = uint256(100);
        periodLengthesInBlocks[1] = uint256(100);
        periodLengthesInBlocks[2] = uint256(100);
        periodLengthesInBlocks[3] = uint256(100);

        _START_BLOCK = block.number + 10;

        // 4. TokenDistributor deployment
        tokenDistributor = new TokenDistributor(
            address(looksRareToken),
            _TOKEN_SPLITTER,
            _START_BLOCK,
            rewardsPerBlockForStaking,
            rewardsPerBlockForOthers,
            periodLengthesInBlocks,
            4
        );

        looksRareToken.transferOwnership(address(tokenDistributor));

        // 5. FeeSharingSystem deployment
        feeSharingSystem = new FeeSharingSystem(
            address(looksRareToken),
            address(rewardToken),
            address(tokenDistributor)
        );

        // 6. Aggregator deployment
        aggregatorFeeSharingWithUniswapV3 = new AggregatorFeeSharingWithUniswapV3(
            address(feeSharingSystem),
            address(uniswapRouter)
        );

        aggregatorFeeSharingWithUniswapV3.startHarvest();
        aggregatorFeeSharingWithUniswapV3.updateThresholdAmount(_parseEtherWithFloating(5, 1));
        aggregatorFeeSharingWithUniswapV3.updateHarvestBufferBlocks(10);

        // 7. Distribute LOOKS to user accounts (from the premint)
        address[4] memory users = [address(1), address(2), address(3), address(4)];

        for (uint256 i = 0; i < users.length; i++) {
            cheats.prank(_PREMINT_RECEIVER);
            looksRareToken.transfer(users[i], _parseEther(300));

            cheats.prank(users[i]);
            looksRareToken.approve(address(aggregatorFeeSharingWithUniswapV3), type(uint256).max);
        }
    }

    function testConstructor() public {
        assertEq(looksRareToken.name(), "LooksRare Token");
        assertEq(looksRareToken.symbol(), "LOOKS");
        assertEq(looksRareToken.totalSupply(), _parseEther(_PREMINT_AMOUNT));
        assertEq(_parseEther(1), _parseEtherWithFloating(1, 0));
    }

    function testDeposit() public asPrankedUser(user1) {
        aggregatorFeeSharingWithUniswapV3.deposit(_parseEther(100));

        uint256 currentBalanceUser1 = looksRareToken.balanceOf(user1);
        assertEq(aggregatorFeeSharingWithUniswapV3.userInfo(user1), _parseEther(100));
        assertEq(aggregatorFeeSharingWithUniswapV3.calculateSharesValueInLOOKS(user1), _parseEther(100));

        // Time travel by 1 block
        cheats.roll(_START_BLOCK + 1);
        assertEq(aggregatorFeeSharingWithUniswapV3.calculateSharesValueInLOOKS(user1), _parseEther(130));
        aggregatorFeeSharingWithUniswapV3.withdrawAll();

        // 200 LOOKS + 130 LOOKS = 330 LOOKS
        assertEq(looksRareToken.balanceOf(user1), _parseEther(130) + currentBalanceUser1);
        assertEq(aggregatorFeeSharingWithUniswapV3.calculateSharesValueInLOOKS(user1), _parseEther(0));
    }

    function testDepositAndWithdrawSameBlock(uint8 x, uint16 numberBlocks) public asPrankedUser(user1) {
        uint256 amountDeposit = _parseEther(x);
        cheats.assume(amountDeposit >= aggregatorFeeSharingWithUniswapV3.MINIMUM_DEPOSIT_LOOKS());
        cheats.roll(_START_BLOCK + uint256(numberBlocks));

        aggregatorFeeSharingWithUniswapV3.deposit(amountDeposit);
        uint256 currentBalanceUser1 = looksRareToken.balanceOf(user1);
        aggregatorFeeSharingWithUniswapV3.withdrawAll();
        assertEq(looksRareToken.balanceOf(user1), currentBalanceUser1 + amountDeposit);
    }
}
