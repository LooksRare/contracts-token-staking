import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { advanceBlock, advanceBlockTo, pauseAutomine, resumeAutomine } from "./helpers/block-traveller";

const { parseEther } = utils;

async function setupUsers(
  feeSharingSystem: Contract,
  looksRareToken: Contract,
  aggregator: Contract,
  admin: SignerWithAddress,
  users: SignerWithAddress[]
): Promise<void> {
  for (const user of users) {
    await looksRareToken.connect(admin).transfer(user.address, parseEther("200"));
    await looksRareToken.connect(user).approve(feeSharingSystem.address, constants.MaxUint256);
    await looksRareToken.connect(user).approve(aggregator.address, constants.MaxUint256);
    await aggregator.connect(user).deposit(parseEther("100"));
  }
}

describe("AggregatorFeeSharing", () => {
  let aggregator: Contract;
  let feeSharingSetter: Contract;
  let feeSharingSystem: Contract;
  let looksRareToken: Contract;
  let rewardToken: Contract;
  let uniswapRouter: Contract;
  let tokenDistributor: Contract;

  let admin: SignerWithAddress;
  let accounts: SignerWithAddress[];

  let startBlock: BigNumber;
  let rewardDurationPerBlock: BigNumber;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    admin = accounts[0];
    const tokenSplitter = accounts[19];

    const premintReceiver = admin;
    const premintAmount = parseEther("6250");
    const cap = parseEther("25000"); // 25,000 tokens

    const rewardsPerBlockForStaking = [parseEther("30"), parseEther("15"), parseEther("7.5"), parseEther("3.75")];
    const rewardsPerBlockForOthers = [parseEther("70"), parseEther("35"), parseEther("17.5"), parseEther("8.75")];
    const periodLengthesInBlocks = [
      BigNumber.from("100"),
      BigNumber.from("100"),
      BigNumber.from("100"),
      BigNumber.from("100"),
    ];

    const numberPeriods = "4";

    // 30 * 100 + 15 * 100 + 7.5 * 100 + 3.75 * 100 = 5625 tokens to be distributed to stakers
    // 70 * 100 + 35 * 100 + 17.5 * 100 + 8.75 * 100 = 13,125 tokens to be distributed to fee splitter
    // Expected total supply at the end: 6250 + 5625 + 13,125 = 25,000 tokens
    startBlock = BigNumber.from(await ethers.provider.getBlockNumber()).add("100");

    const LooksRareToken = await ethers.getContractFactory("LooksRareToken");
    looksRareToken = await LooksRareToken.deploy(premintReceiver.address, premintAmount, cap);
    await looksRareToken.deployed();

    const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
    tokenDistributor = await TokenDistributor.deploy(
      looksRareToken.address,
      tokenSplitter.address,
      startBlock,
      rewardsPerBlockForStaking,
      rewardsPerBlockForOthers,
      periodLengthesInBlocks,
      numberPeriods
    );
    await tokenDistributor.deployed();
    await looksRareToken.connect(admin).transferOwnership(tokenDistributor.address);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    rewardToken = await MockERC20.deploy("Mock WETH", "WETH");
    await rewardToken.deployed();
    await rewardToken.connect(admin).mint(admin.address, parseEther("500000"));

    rewardDurationPerBlock = BigNumber.from("50");

    const FeeSharingSystem = await ethers.getContractFactory("FeeSharingSystem");
    feeSharingSystem = await FeeSharingSystem.deploy(
      looksRareToken.address,
      rewardToken.address,
      tokenDistributor.address
    );
    await feeSharingSystem.deployed();

    const minRewardDurationInBlocks = "30";
    const maxRewardDurationInBlocks = "41000";

    const FeeSharingSetter = await ethers.getContractFactory("FeeSharingSetter");
    feeSharingSetter = await FeeSharingSetter.deploy(
      feeSharingSystem.address,
      minRewardDurationInBlocks,
      maxRewardDurationInBlocks,
      rewardDurationPerBlock
    );
    await feeSharingSetter.deployed();

    await feeSharingSystem.connect(admin).transferOwnership(feeSharingSetter.address);
    await feeSharingSetter.connect(admin).grantRole(await feeSharingSetter.OPERATOR_ROLE(), admin.address);

    const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router");
    uniswapRouter = await MockUniswapV3Router.deploy();
    // 1 WETH is sold for 2 LOOKS
    await uniswapRouter.connect(admin).setMultiplier("20000");

    // Transfer 2,250 LOOKS to mock router
    await looksRareToken.connect(admin).transfer(uniswapRouter.address, parseEther("2250"));

    const AggregatorFeeSharingWithUniswapV3 = await ethers.getContractFactory("AggregatorFeeSharingWithUniswapV3");
    aggregator = await AggregatorFeeSharingWithUniswapV3.deploy(feeSharingSystem.address, uniswapRouter.address);
    await aggregator.deployed();
  });

  describe("#1 - Regular user/admin interactions", async () => {
    it("Users can use the contract as autocompounder if no reward", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);

      // Equal to initial deposit
      assert.deepEqual(await aggregator.userInfo(user1.address), parseEther("100"));
      assert.deepEqual(await aggregator.userInfo(user2.address), parseEther("100"));
      assert.deepEqual(await aggregator.userInfo(user3.address), parseEther("100"));

      // Advance block rewards to startBlock
      await advanceBlockTo(await tokenDistributor.START_BLOCK());

      assert.deepEqual(await feeSharingSystem.calculateSharePriceInLOOKS(), BigNumber.from((1e18).toString()));
      assert.deepEqual(await aggregator.totalShares(), parseEther("300"));
      assert.deepEqual(await feeSharingSystem.calculateSharesValueInLOOKS(aggregator.address), parseEther("300"));
      assert.deepEqual(await aggregator.calculateSharePriceInPrimeShare(), BigNumber.from((1e18).toString()));
      assert.deepEqual(await aggregator.calculateSharePriceInLOOKS(), BigNumber.from((1e18).toString()));
      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), constants.Zero);
      assert.deepEqual(await feeSharingSystem.totalShares(), parseEther("300"));
      assert.deepEqual(await feeSharingSystem.lastRewardBlock(), await feeSharingSystem.periodEndBlock());
      assert.deepEqual(await tokenDistributor.accTokenPerShare(), constants.Zero);

      await advanceBlockTo(BigNumber.from((await tokenDistributor.START_BLOCK()).toString()).add(constants.One));

      // 30 LOOKS per block / 3 = 10
      // New exchange rate is 110 for 100 LOOKS
      assert.deepEqual(await aggregator.calculateSharesValueInLOOKS(user1.address), parseEther("110"));
      assert.deepEqual(await feeSharingSystem.calculateSharePriceInLOOKS(), parseEther("1.10"));
      assert.deepEqual(await aggregator.calculateSharePriceInLOOKS(), parseEther("1.10"));

      const tx = await aggregator.connect(user1).withdrawAll();
      await expect(tx).to.emit(aggregator, "Withdraw").withArgs(user1.address, parseEther("120"));

      assert.deepEqual(await feeSharingSystem.calculateSharePriceInLOOKS(), parseEther("1.20"));
      assert.deepEqual(await aggregator.calculateSharePriceInLOOKS(), parseEther("1.20"));
      assert.deepEqual(await aggregator.userInfo(user1.address), constants.Zero);
    });

    it("Users can deposit, it sells rewards automatically when above threshold", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);
      await aggregator.connect(admin).updateThresholdAmount(parseEther("5"));
      await aggregator.connect(admin).startHarvest();

      // Transfer 50 WETH token to the contract (50 blocks with 1 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("50"));

      // Admin launches the first fee sharing
      await feeSharingSetter.connect(admin).updateRewards();

      // Advanced to the end of the first fee-sharing
      await advanceBlockTo(BigNumber.from((await tokenDistributor.START_BLOCK()).toString()).add("49"));

      const tx = await aggregator.connect(user1).deposit(parseEther("10"));
      await expect(tx).to.emit(aggregator, "Deposit").withArgs(user1.address, parseEther("10"));

      // 50 WETH sold for 100 LOOKS
      await expect(tx)
        .to.emit(aggregator, "ConversionToLOOKS")
        .withArgs(parseEther("49.99999999999999980"), parseEther("99.9999999999999996"));
    });

    it("Users can deposit, it does not sell rewards if below threshold or if deactivated", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);
      await aggregator.connect(admin).updateThresholdAmount(parseEther("50.000001"));
      await aggregator.connect(admin).startHarvest();

      // Transfer 50 WETH token to the contract (50 blocks with 1 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("50"));

      // Admin launches the first fee sharing
      await feeSharingSetter.connect(admin).updateRewards();

      // Advanced to the end of the first fee-sharing
      await advanceBlockTo(BigNumber.from((await tokenDistributor.START_BLOCK()).toString()).add("49"));
    });

    it("Users can withdraw, it sells rewards automatically when above threshold", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);
      await aggregator.connect(admin).updateThresholdAmount(parseEther("5"));

      // Transfer 50 WETH token to the contract (50 blocks with 1 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("50"));
      await aggregator.connect(admin).startHarvest();

      // Advance block rewards to startBlock - 1
      await advanceBlockTo(BigNumber.from((await tokenDistributor.START_BLOCK()).toString()).sub("1"));
      assert.deepEqual(await feeSharingSystem.calculateSharePriceInLOOKS(), BigNumber.from((1e18).toString()));

      // Admin launches the first fee sharing
      await feeSharingSetter.connect(admin).updateRewards();

      // Advanced to the end of the first fee-sharing
      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()).add("49"));

      // User1 withdraws all
      let tx = await aggregator.connect(user1).withdrawAll();

      // 50 WETH is sold for 100 LOOKS
      await expect(tx)
        .to.emit(aggregator, "ConversionToLOOKS")
        .withArgs(parseEther("49.99999999999999980"), parseEther("99.9999999999999996"));

      // 50 * 10 = 500 LOOKS (+ the initial 100 LOOKS)
      // + 99.9999999999999996 / 3 = 33.333333333333333198
      await expect(tx).to.emit(aggregator, "Withdraw").withArgs(user1.address, parseEther("633.333333333333333198"));

      // User2 withdraws all (one block after)
      tx = await aggregator.connect(user2).withdraw(parseEther("100"));

      // Normal staking: 50 * 10 + 1 * 15 = 515 LOOKS (+ the initial 100 LOOKS)
      // Auto-compounded: 99.999999 / 2 = 49.999998
      await expect(tx).to.emit(aggregator, "Withdraw").withArgs(user2.address, parseEther("648.333333333133333194"));
    });

    it("Users can withdraw, it does not sell rewards if below threshold or if deactivated", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);

      const newThreshold = parseEther("50.00001");
      await aggregator.connect(admin).updateThresholdAmount(newThreshold);
      assert.deepEqual(await aggregator.thresholdAmount(), newThreshold);

      // Transfer 50 WETH token to the contract (50 blocks with 1 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("50"));
      await aggregator.connect(admin).startHarvest();

      // Admin launches the first fee sharing
      await feeSharingSetter.connect(admin).updateRewards();

      // Advance block rewards to startBlock - 1
      await advanceBlockTo(BigNumber.from((await tokenDistributor.START_BLOCK()).toString()).sub("1"));

      const tx = await aggregator.connect(user1).withdraw(parseEther("1"));
      await expect(tx).not.to.emit(aggregator, "ConversionToLOOKS");
      await expect(tx).not.to.emit(aggregator, "FailedConversion");
      await expect(tx).not.to.emit(feeSharingSystem, "Deposit");
      assert.notEqual(await rewardToken.balanceOf(aggregator.address), constants.Zero);
    });

    it("Owner can harvest using the harvest functions", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);
      await aggregator.connect(admin).updateThresholdAmount(parseEther("4.5"));
      await rewardToken.connect(admin).transfer(aggregator.address, parseEther("4.5"));

      // 4.5 WETH sold for 9 LOOKS (and deposited back)
      const tx = await aggregator.connect(admin).harvestAndSellAndCompound();
      await expect(tx).to.emit(aggregator, "ConversionToLOOKS").withArgs(parseEther("4.5"), parseEther("9"));
      await expect(tx)
        .to.emit(feeSharingSystem, "Deposit")
        .withArgs(aggregator.address, parseEther("9"), parseEther("0"));

      // 9 LOOKS added to a pool of 300 LOOKS staked --> 310 LOOKS for 300 shares --> 1.03 LOOKS per share
      assert.deepEqual(await aggregator.calculateSharePriceInLOOKS(), parseEther("1.03"));
      assert.deepEqual(await aggregator.calculateSharePriceInPrimeShare(), parseEther("1.03"));

      // The share price in LOOKS of the fee sharing contract did not change
      assert.deepEqual(await feeSharingSystem.calculateSharePriceInLOOKS(), parseEther("1"));
    });

    it("Harvest doesn't trigger reinvesting if amount received is less than 1 LOOKS", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);
      // 1 WETH is sold for 1 LOOKS
      await uniswapRouter.setMultiplier("10000");
      await aggregator.connect(admin).updateThresholdAmount(parseEther("0.999"));
      await rewardToken.connect(admin).transfer(aggregator.address, parseEther("0.999"));

      const tx = await aggregator.connect(admin).harvestAndSellAndCompound();
      // Amount is equal to the threshold to trigger the selling
      await expect(tx).to.emit(aggregator, "ConversionToLOOKS").withArgs(parseEther("0.999"), parseEther("0.999"));
      // Amount is lower than threshold to trigger the deposit
      await expect(tx).not.to.emit(feeSharingSystem, "Deposit");
    });

    it("Slippage protections work as expected", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);

      // 1 WETH must be sold at least for 100 LOOKS
      await aggregator.connect(admin).updateMaxPriceOfLOOKSInWETH(parseEther("0.01"));

      // 1 WETH is sold for 100 LOOKS
      await uniswapRouter.setMultiplier("1000000");

      // Transfer 1 LOOKS
      await rewardToken.connect(admin).transfer(aggregator.address, parseEther("1"));
      let tx = await aggregator.connect(admin).harvestAndSellAndCompound();

      // Amount is same as threshold... it doesn't trigger the error
      await expect(tx).not.to.emit(uniswapRouter, "SlippageError");

      // 1 WETH is now sold for 99.999 LOOKS
      await uniswapRouter.setMultiplier("999999");

      // Transfer 1 LOOKS
      await rewardToken.connect(admin).transfer(aggregator.address, parseEther("1"));
      tx = await aggregator.connect(admin).harvestAndSellAndCompound();

      // Amount is lower than threshold to trigger the deposit
      await expect(tx).to.emit(uniswapRouter, "SlippageError");
    });
  });

  describe("#2 - Revertions work as expected", async () => {
    it("Users cannot deposit if less than minimum or withdraw without funds", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      const noDepositUser = accounts[10];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);

      const minDepositAmount = BigNumber.from((await aggregator.MINIMUM_DEPOSIT_LOOKS()).toString());

      await expect(aggregator.connect(user1).deposit(minDepositAmount.sub(BigNumber.from("1")))).to.be.revertedWith(
        "Deposit: Amount must be >= 1 LOOKS"
      );

      await expect(aggregator.connect(noDepositUser).withdraw("0")).to.be.revertedWith(
        "Withdraw: Shares equal to 0 or larger than user shares"
      );

      await expect(aggregator.connect(noDepositUser).withdraw("1")).to.be.revertedWith(
        "Withdraw: Shares equal to 0 or larger than user shares"
      );

      await expect(aggregator.connect(noDepositUser).withdrawAll()).to.be.revertedWith("Withdraw: Shares equal to 0");
    });

    it("Cannot deposit if it is paused", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);
      await aggregator.connect(admin).pause();
      await expect(aggregator.connect(user1).deposit(parseEther("10"))).to.be.revertedWith("Pausable: paused");

      await aggregator.connect(admin).unpause();
    });

    it("Cannot harvest if no outstanding share", async () => {
      await expect(aggregator.connect(admin).harvestAndSellAndCompound()).to.be.revertedWith("Harvest: No share");
    });

    it("Cannot harvest if already harvested in same block", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);
      await pauseAutomine();
      await aggregator.connect(admin).harvestAndSellAndCompound();
      const tx = await aggregator.connect(admin).harvestAndSellAndCompound();
      const pendingBlock = await ethers.provider.send("eth_getBlockByNumber", ["pending", false]);
      // Verify there are 2+ txs in the mempool
      assert.isAtLeast(pendingBlock.transactions.length, 2);
      await advanceBlock();
      await resumeAutomine();
      await expect(tx.wait()).to.be.reverted;
    });

    it("Faulty router doesn't throw revertion on harvesting operations if it fails to sell", async () => {
      const MockFaultyUniswapV3Router = await ethers.getContractFactory("MockFaultyUniswapV3Router");
      const faultyUniswapRouter = await MockFaultyUniswapV3Router.deploy();
      await faultyUniswapRouter.deployed();

      const AggregatorFeeSharingWithUniswapV3 = await ethers.getContractFactory("AggregatorFeeSharingWithUniswapV3");
      aggregator = await AggregatorFeeSharingWithUniswapV3.deploy(
        feeSharingSystem.address,
        faultyUniswapRouter.address
      );
      await aggregator.deployed();

      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);

      const tx = await aggregator.connect(admin).harvestAndSellAndCompound();
      await aggregator.connect(admin).updateThresholdAmount(parseEther("4.5"));
      await rewardToken.connect(admin).transfer(aggregator.address, parseEther("4.5"));

      await expect(tx).to.emit(aggregator, "FailedConversion");
    });
  });

  describe("#3 - Admin functions", async () => {
    it("Owner can update UniswapV3 fee", async () => {
      const tx = await aggregator.connect(admin).updateTradingFeeUniswapV3("10000");
      await expect(tx).to.emit(aggregator, "NewTradingFeeUniswapV3").withArgs(BigNumber.from("10000"));
      assert.equal(await aggregator.tradingFeeUniswapV3(), "10000");
    });

    it("Owner can start/stop auto-harvest", async () => {
      let tx = await aggregator.connect(admin).startHarvest();
      await expect(tx).to.emit(aggregator, "HarvestStart");

      tx = await aggregator.connect(admin).stopHarvest();
      await expect(tx).to.emit(aggregator, "HarvestStop");
    });

    it("Owner can update threshold amount", async () => {
      const tx = await aggregator.connect(admin).updateThresholdAmount(parseEther("5"));
      await expect(tx).to.emit(aggregator, "NewThresholdAmount").withArgs(parseEther("5"));
    });

    it("Owner can adjust buffer block only within limits", async () => {
      const MAXIMUM_HARVEST_BUFFER_BLOCKS = await aggregator.MAXIMUM_HARVEST_BUFFER_BLOCKS();
      const tx = await aggregator.connect(admin).updateHarvestBufferBlocks(MAXIMUM_HARVEST_BUFFER_BLOCKS);
      await expect(tx).to.emit(aggregator, "NewHarvestBufferBlocks").withArgs(MAXIMUM_HARVEST_BUFFER_BLOCKS);

      await expect(
        aggregator.connect(admin).updateHarvestBufferBlocks(MAXIMUM_HARVEST_BUFFER_BLOCKS.add("1"))
      ).to.be.revertedWith("Owner: Must be below MAXIMUM_HARVEST_BUFFER_BLOCKS");
    });

    it("Owner can reset maximum allowance for LOOKS token", async () => {
      const tx = await aggregator.connect(admin).checkAndAdjustLOOKSTokenAllowanceIfRequired();
      await expect(tx)
        .to.emit(looksRareToken, "Approval")
        .withArgs(aggregator.address, feeSharingSystem.address, constants.MaxUint256);
    });

    it("Owner can reset maximum allowance for reward token", async () => {
      const tx = await aggregator.connect(admin).checkAndAdjustRewardTokenAllowanceIfRequired();
      await expect(tx)
        .to.emit(rewardToken, "Approval")
        .withArgs(aggregator.address, uniswapRouter.address, constants.MaxUint256);
    });

    it("Owner can pause/unpause", async () => {
      let tx = await aggregator.connect(admin).pause();
      await expect(tx).to.emit(aggregator, "Paused");

      tx = await aggregator.connect(admin).unpause();
      await expect(tx).to.emit(aggregator, "Unpaused");
    });

    it("Owner cannot pause/unpause if paused", async () => {
      await expect(aggregator.connect(admin).unpause()).to.be.revertedWith("Pausable: not paused");
      await aggregator.connect(admin).pause();
      await expect(aggregator.connect(admin).pause()).to.be.revertedWith("Pausable: paused");
    });

    it("Owner cannot update UniswapV3 fee if wrong fee", async () => {
      await expect(aggregator.connect(admin).updateTradingFeeUniswapV3("1")).to.be.revertedWith("Owner: Fee invalid");
      await expect(aggregator.connect(admin).updateTradingFeeUniswapV3("9999")).to.be.revertedWith(
        "Owner: Fee invalid"
      );
    });

    it("Owner can update minPriceLOOKSInWETH", async () => {
      // 1 LOOKS is at most equal to 0.01 WETH
      // 1 WETH is at least equal to 100 LOOKS
      const tx = await aggregator.connect(admin).updateMaxPriceOfLOOKSInWETH(parseEther("0.01"));
      await expect(tx).to.emit(aggregator, "NewMaximumPriceLOOKSInWETH").withArgs(parseEther("0.01"));
      assert.deepEqual(await aggregator.maxPriceLOOKSInWETH(), parseEther("0.01"));
    });

    it("Only owner can call functions for onlyOwner", async () => {
      const [user1, user2, user3] = [accounts[1], accounts[2], accounts[3]];
      await setupUsers(feeSharingSystem, looksRareToken, aggregator, admin, [user1, user2, user3]);

      await expect(aggregator.connect(user1).harvestAndSellAndCompound()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(aggregator.connect(user1).updateTradingFeeUniswapV3("200")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(aggregator.connect(user1).updateThresholdAmount("10")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(aggregator.connect(user1).updateMaxPriceOfLOOKSInWETH(parseEther("0.01"))).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(aggregator.connect(user1).pause()).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(aggregator.connect(user1).unpause()).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(aggregator.connect(user1).startHarvest()).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(aggregator.connect(user1).stopHarvest()).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(aggregator.connect(user1).checkAndAdjustLOOKSTokenAllowanceIfRequired()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(aggregator.connect(user1).checkAndAdjustRewardTokenAllowanceIfRequired()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(aggregator.connect(user1).stopHarvest()).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
