import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { defaultAbiCoder } from "ethers/lib/utils";
import { advanceBlockTo } from "./helpers/block-traveller";

const { parseEther } = utils;

describe("FeeSharingSystem", () => {
  let feeSharingSetter: Contract;
  let feeSharingSystem: Contract;
  let rewardToken: Contract;
  let looksRareToken: Contract;
  let tokenDistributor: Contract;

  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let feeSharingRecipient1: SignerWithAddress;
  let feeSharingRecipient2: SignerWithAddress;
  let premintReceiver: SignerWithAddress;
  let tokenSplitter: SignerWithAddress;

  let startBlock: BigNumber;
  let rewardDurationPerBlock: BigNumber;

  beforeEach(async () => {
    const premintAmount = parseEther("2250");
    const cap = parseEther("21000"); // 21,000 tokens

    [admin, user1, user2, user3, user4, feeSharingRecipient1, feeSharingRecipient2, tokenSplitter] =
      await ethers.getSigners();

    premintReceiver = admin;

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
    // Expected total supply at the end: 2250 + 5625 + 13,125 = 21,000 tokens

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

    // Each user receives 500 LOOKS tokens and deposits 100 LOOKS
    for (const user of [user1, user2, user3, user4]) {
      await looksRareToken.connect(admin).transfer(user.address, parseEther("200"));
      await looksRareToken.connect(user).approve(feeSharingSystem.address, constants.MaxUint256);
      await feeSharingSystem.connect(user).deposit(parseEther("100"), false);
    }
  });

  describe("#1 - Regular user/admin interactions", async () => {
    it("Users can use the contract as autocompounder if no reward", async () => {
      // Advance block rewards to startBlock
      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()));

      assert.deepEqual(await feeSharingSystem.calculateSharePriceInLOOKS(), BigNumber.from((1e18).toString()));

      // No reward
      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), constants.Zero);
      assert.deepEqual(await feeSharingSystem.totalShares(), parseEther("400"));
      assert.deepEqual(await feeSharingSystem.lastRewardBlock(), await feeSharingSystem.periodEndBlock());
      assert.deepEqual(await tokenDistributor.accTokenPerShare(), parseEther("0"));

      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()).add(constants.One));

      // 30 LOOKS per block / 4 = 7.5
      // New exchange rate is 107.5 for 100 LOOKS
      assert.deepEqual(await feeSharingSystem.calculateSharesValueInLOOKS(user1.address), parseEther("107.5"));
      assert.deepEqual(await feeSharingSystem.calculateSharePriceInLOOKS(), parseEther("1.075"));

      let tx = await feeSharingSystem.connect(user1).withdrawAll(true);

      await expect(tx)
        .to.emit(feeSharingSystem, "Withdraw")
        .withArgs(user1.address, parseEther("115"), parseEther("0"));

      let totalAmountStaked = (await tokenDistributor.userInfo(feeSharingSystem.address))[0];
      let expectedAmountToReceive = await tokenDistributor.calculatePendingRewards(feeSharingSystem.address);

      let userShares = (await feeSharingSystem.userInfo(user2.address))[0];
      let totalShares = await feeSharingSystem.totalShares();

      assert.deepEqual(
        totalAmountStaked.add(expectedAmountToReceive).mul(userShares).div(totalShares),
        parseEther("115")
      );

      assert.deepEqual(await tokenDistributor.accTokenPerShare(), parseEther("0.00000015"));

      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()).add("3"));

      totalAmountStaked = (await tokenDistributor.userInfo(feeSharingSystem.address))[0];
      expectedAmountToReceive = await tokenDistributor.calculatePendingRewards(feeSharingSystem.address);

      userShares = (await feeSharingSystem.userInfo(user2.address))[0];
      totalShares = await feeSharingSystem.totalShares();

      let expectedValue = parseEther("124.999999999985000000");

      assert.deepEqual(
        totalAmountStaked.add(expectedAmountToReceive).mul(userShares).div(totalShares),
        await feeSharingSystem.calculateSharesValueInLOOKS(user2.address)
      );

      assert.deepEqual(await feeSharingSystem.calculateSharesValueInLOOKS(user2.address), expectedValue);

      // 115 + 60 LOOKS / 3 = 135
      tx = await feeSharingSystem.connect(user2).withdrawAll(true);
      expectedValue = parseEther("134.99999999997");
      await expect(tx).to.emit(feeSharingSystem, "Withdraw").withArgs(user2.address, expectedValue, parseEther("0"));

      totalAmountStaked = (await tokenDistributor.userInfo(feeSharingSystem.address))[0];
      expectedAmountToReceive = await tokenDistributor.calculatePendingRewards(feeSharingSystem.address);
      userShares = (await feeSharingSystem.userInfo(user3.address))[0];
      totalShares = await feeSharingSystem.totalShares();

      assert.deepEqual(
        totalAmountStaked.add(expectedAmountToReceive).mul(userShares).div(totalShares),
        await feeSharingSystem.calculateSharesValueInLOOKS(user3.address)
      );

      assert.deepEqual(await feeSharingSystem.calculateSharesValueInLOOKS(user3.address), expectedValue);

      // Verify nobody is claiming anything
      assert.deepEqual(await rewardToken.balanceOf(user1.address), parseEther("0"));
      assert.deepEqual(await rewardToken.balanceOf(user1.address), await rewardToken.balanceOf(user2.address));
    });

    it("Users can unstake and collect rewards", async () => {
      // Transfer 500 WETH token to the contract (50 blocks with 10 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("500"));

      // Advance block rewards to startBlock - 1
      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()));

      assert.deepEqual(await feeSharingSystem.calculateSharePriceInLOOKS(), BigNumber.from((1e18).toString()));

      // Admin launches the first fee sharing
      await feeSharingSetter.connect(admin).updateRewards();

      // Advance to periodEndBlock
      await advanceBlockTo(BigNumber.from(await feeSharingSystem.periodEndBlock()));

      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("10"));
      assert.deepEqual(await feeSharingSystem.totalShares(), parseEther("400"));
      assert.deepEqual(await feeSharingSystem.lastRewardBlock(), await feeSharingSystem.periodEndBlock());

      for (const user of [user1, user2, user3, user4]) {
        const tx = await feeSharingSystem.connect(user).withdrawAll(true);
        await expect(tx).to.emit(tokenDistributor, "Withdraw");
        await expect(tx).to.emit(feeSharingSystem, "Withdraw");
      }

      // 500 / 4 = 125 WETH per user
      assert.deepEqual(await rewardToken.balanceOf(user1.address), parseEther("125"));
      assert.deepEqual(await rewardToken.balanceOf(user1.address), await rewardToken.balanceOf(user2.address));
    });

    it("Users can deposit multiple times and harvest if requested", async () => {
      // Transfer 500 WETH token to the contract (50 blocks with 10 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("500"));

      // Advance block rewards to startBlock - 1
      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()));

      // 1. Rewards are updated for the first phase
      let tx = await feeSharingSetter.connect(admin).updateRewards();

      await expect(tx).to.emit(feeSharingSystem, "NewRewardPeriod").withArgs("50", parseEther("10"), parseEther("500"));

      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("10"));
      assert.deepEqual(await feeSharingSystem.totalShares(), parseEther("400"));

      // Advance to end of the period
      const periodEndBlock = await feeSharingSystem.periodEndBlock();

      await advanceBlockTo(BigNumber.from(periodEndBlock));

      // User1: 125 // User2: 125 // User3: 125 // User4: 125
      tx = await feeSharingSystem.connect(user1).deposit(parseEther("10"), true);

      await expect(tx).to.emit(tokenDistributor, "Deposit");
      await expect(tx)
        .to.emit(tokenDistributor, "Deposit")
        .withArgs(feeSharingSystem.address, parseEther("10"), parseEther("0"));
    });

    it("Owner can adjust the block schedule", async () => {
      // Transfer 500 WETH token to the contract (50 blocks with 10 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("500"));

      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()));

      // 1. Rewards are updated for the first phase
      let tx = await feeSharingSetter.connect(admin).updateRewards();
      await expect(tx).to.emit(feeSharingSystem, "NewRewardPeriod").withArgs("50", parseEther("10"), parseEther("500"));

      tx = await feeSharingSetter.setNewRewardDurationInBlocks("100");
      await expect(tx).to.emit(feeSharingSetter, "NewRewardDurationInBlocks").withArgs("100");
      assert.deepEqual(await feeSharingSetter.rewardDurationInBlocks(), BigNumber.from("50"));
      assert.deepEqual(await feeSharingSetter.nextRewardDurationInBlocks(), BigNumber.from("100"));

      // Advance to end of the period
      const periodEndBlock = await feeSharingSystem.periodEndBlock();
      await advanceBlockTo(BigNumber.from(periodEndBlock));

      // Transfer 800 WETH token to the contract (100 blocks with 8 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("800"));

      // 2. Rewards are updated for the second phase
      tx = await feeSharingSetter.connect(admin).updateRewards();
      await expect(tx).to.emit(feeSharingSystem, "NewRewardPeriod").withArgs("100", parseEther("8"), parseEther("800"));
      assert.deepEqual(await feeSharingSetter.rewardDurationInBlocks(), BigNumber.from("100"));
    });

    it("Users can stake/unstake and collect WETH + LOOKS", async () => {
      // Transfer 500 WETH token to the contract (50 blocks with 10 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("500"));

      // Advance block rewards to startBlock - 1
      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()));

      // 1. Rewards are updated for the first phase
      let tx = await feeSharingSetter.connect(admin).updateRewards();
      await expect(tx).to.emit(feeSharingSystem, "NewRewardPeriod").withArgs("50", parseEther("10"), parseEther("500"));
      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("10"));
      assert.deepEqual(await feeSharingSystem.totalShares(), parseEther("400"));

      // Advance to end of the period
      const periodEndBlock = await feeSharingSystem.periodEndBlock();
      await advanceBlockTo(BigNumber.from(periodEndBlock));

      assert.deepEqual(await feeSharingSystem.calculatePendingRewards(user1.address), parseEther("125"));

      // User1: 125 // User2: 125 // User3: 125 // User4: 125
      tx = await feeSharingSystem.connect(user1).withdrawAll(true);
      expect(tx).to.emit(tokenDistributor, "Withdraw");
      // 52 blocks // 30 / 4 * 52 = 390 LOOKS
      expect(tx).to.emit(feeSharingSystem, "Withdraw").withArgs(user1.address, parseEther("490"), parseEther("125"));
      tx = await feeSharingSystem.connect(user2).withdrawAll(true);
      expect(tx).to.emit(tokenDistributor, "Withdraw");

      // 390 + 30 / 3 = 399.99999999985
      expect(tx)
        .to.emit(feeSharingSystem, "Withdraw")
        .withArgs(user2.address, parseEther("499.99999999985"), parseEther("125"), parseEther("0"));

      // Transfer 5000 WETH token to the contract (50 blocks with 100 WETH/block)
      let rewardAdded = parseEther("5000");
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, rewardAdded);

      // 2. Rewards are updated for the second phase
      tx = await feeSharingSetter.connect(admin).updateRewards();
      await expect(tx)
        .to.emit(feeSharingSystem, "NewRewardPeriod")
        .withArgs(BigNumber.from("50"), parseEther("100"), rewardAdded);
      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("100"));

      await advanceBlockTo(BigNumber.from(await feeSharingSystem.periodEndBlock()));

      // User1: 0(125) // User2: 0(125) // User3: 2625 // User4: 2625
      tx = await feeSharingSystem.connect(user3).harvest();
      await expect(tx).to.emit(feeSharingSystem, "Harvest").withArgs(user3.address, parseEther("2625"));

      // #3 - User launches the third phase of fee sharing
      // Transfer 10,000 WETH token to the contract (50 blocks with 400 WETH/block)
      rewardAdded = parseEther("10000");
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, rewardAdded);

      tx = await feeSharingSetter.connect(admin).updateRewards();
      await expect(tx)
        .to.emit(feeSharingSystem, "NewRewardPeriod")
        .withArgs("50", parseEther("200"), parseEther("10000"));

      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("200"));

      const halfPeriodEndBlock = BigNumber.from(await feeSharingSystem.periodEndBlock()).sub("26");
      await advanceBlockTo(halfPeriodEndBlock);

      // User1: 0(125) // User2: 0(125) // User3: 2500(7625) // User4: 7625
      // user3.address withdraws the entire amount
      tx = await feeSharingSystem.connect(user3).withdrawAll(true);

      await expect(tx).to.emit(tokenDistributor, "Withdraw");
      await expect(tx)
        .to.emit(feeSharingSystem, "Withdraw")
        .withArgs(user3.address, parseEther("1452.49999999956425"), parseEther("2500"));

      await advanceBlockTo(await feeSharingSystem.periodEndBlock());

      // User1: 0(125) // User2: 0(125) // User3: 0(7625) // User4: 10125
      // User4 withdraws the entire amount
      const result = await feeSharingSystem.userInfo(user4.address);
      const userShares = result[0];

      tx = await feeSharingSystem.connect(user4).harvest();
      await expect(tx).to.emit(feeSharingSystem, "Harvest").withArgs(user4.address, parseEther("10125"));

      tx = await feeSharingSystem.connect(user4).withdraw(userShares, false);
      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(feeSharingSystem.address, parseEther("1857.499999997238228290"), parseEther("0"));

      await expect(tx)
        .to.emit(feeSharingSystem, "Withdraw")
        .withArgs(user4.address, parseEther("1857.499999997238228290"), parseEther("0"));

      assert.deepEqual(await feeSharingSystem.totalShares(), constants.Zero);
    });

    it("Rewards are paid as expected for passive staking", async () => {
      // Transfer 500 WETH token to the contract (50 blocks with 10 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("500"));

      const stakingAddresses = [feeSharingRecipient1.address, feeSharingRecipient2.address];

      let tx = await feeSharingSetter.connect(admin).addFeeStakingAddresses(stakingAddresses);
      await expect(tx).to.emit(feeSharingSetter, "FeeStakingAddressesAdded").withArgs(stakingAddresses);
      assert.includeOrderedMembers(await feeSharingSetter.viewFeeStakingAddresses(), stakingAddresses);

      await looksRareToken.connect(admin).transfer(feeSharingRecipient1.address, parseEther("200"));
      await looksRareToken.connect(admin).transfer(feeSharingRecipient2.address, parseEther("200"));

      // 500 WETH exists in the contract
      tx = await feeSharingSetter.connect(admin).updateRewards();

      // Rewards are only 250 WETH since half goes to passive stakers
      await expect(tx).to.emit(feeSharingSystem, "NewRewardPeriod").withArgs("50", parseEther("5"), parseEther("250"));
      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("5"));
      assert.deepEqual(await feeSharingSystem.totalShares(), parseEther("400"));

      // Advance to end of the period
      const periodEndBlock = await feeSharingSystem.periodEndBlock();
      await advanceBlockTo(periodEndBlock);

      // User1: 67.5 // User2: 67.5 // User3: 67.5 // User4: 67.5
      for (const user of [user1, user2]) {
        tx = await feeSharingSystem.connect(user).withdrawAll(true);
        await expect(tx).to.emit(tokenDistributor, "Withdraw");
        await expect(tx).to.emit(feeSharingSystem, "Withdraw");
      }

      tx = await feeSharingSetter.connect(admin).removeFeeStakingAddresses([feeSharingRecipient1.address]);
      await expect(tx).to.emit(feeSharingSetter, "FeeStakingAddressesRemoved").withArgs([feeSharingRecipient1.address]);

      // Transfer 1000 WETH token to the contract (50 blocks with 20 WETH/block)
      const rewardAdded = parseEther("1000");
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, rewardAdded);

      // 2. Rewards are updated for the second phase
      tx = await feeSharingSetter.connect(admin).updateRewards();
      await expect(tx).to.emit(feeSharingSystem, "NewRewardPeriod").withArgs("50", parseEther("10"), parseEther("500"));
      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("10"));

      // 250 (reward round 1) + 500 (reward round2) - 125 (amount withdrawn by users 1/2) = 625
      assert.deepEqual(await rewardToken.balanceOf(feeSharingSystem.address), parseEther("625"));
    });

    it("Rewards can be converted with the reward convertor", async () => {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const randomToken = await MockERC20.deploy("Mock USDT", "USDT");
      await randomToken.mint(feeSharingSetter.address, parseEther("100"));

      await expect(
        feeSharingSetter.convertCurrencyToRewardToken(randomToken.address, defaultAbiCoder.encode([], []))
      ).to.be.revertedWith("Convert: RewardConvertor not set");

      const MockRewardConvertor = await ethers.getContractFactory("MockRewardConvertor");
      const rewardConvertor = await MockRewardConvertor.deploy(feeSharingSetter.address);
      await rewardToken.connect(admin).transfer(rewardConvertor.address, parseEther("10"));

      let tx = await feeSharingSetter.connect(admin).setRewardConvertor(rewardConvertor.address);
      await expect(tx).to.emit(feeSharingSetter, "NewRewardConvertor").withArgs(rewardConvertor.address);

      // Admin can call
      tx = await feeSharingSetter
        .connect(admin)
        .convertCurrencyToRewardToken(randomToken.address, defaultAbiCoder.encode([], []));

      await expect(tx)
        .to.emit(feeSharingSetter, "ConversionToRewardToken")
        .withArgs(randomToken.address, parseEther("100"), parseEther("10"));

      await randomToken.connect(admin).mint(feeSharingSystem.address, parseEther("500"));
      await rewardToken.connect(admin).transfer(rewardConvertor.address, parseEther("30"));

      // Admin cannot convert if nothing to convert
      await expect(
        feeSharingSetter
          .connect(admin)
          .convertCurrencyToRewardToken(randomToken.address, defaultAbiCoder.encode([], []))
      ).to.be.revertedWith("Convert: Amount to convert must be > 0");

      // Admin cannot convert if reward token
      await expect(
        feeSharingSetter
          .connect(admin)
          .convertCurrencyToRewardToken(rewardToken.address, defaultAbiCoder.encode([], []))
      ).to.be.revertedWith("Convert: Cannot be reward token");
    });
  });

  describe("#2 - Alternative logic paths without FeeSharingSetter", async () => {
    it("Cannot update rewards if no reward", async () => {
      await feeSharingSetter.connect(admin).transferOwnershipOfFeeSharingSystem(admin.address);

      // Transfer 500 WETH token to the contract (50 blocks with 10 WETH/block)
      await rewardToken.connect(admin).transfer(feeSharingSystem.address, parseEther("500"));

      // Advance block rewards to startBlock - 1
      await advanceBlockTo(await tokenDistributor.START_BLOCK());

      // 1. Rewards are updated for the first phase
      let tx = await feeSharingSystem.connect(admin).updateRewards(parseEther("500"), "50");

      assert.deepEqual(await feeSharingSystem.rewardPerTokenStored(), constants.Zero);
      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("10"));
      assert.deepEqual(await feeSharingSystem.totalShares(), parseEther("400"));

      await advanceBlockTo(BigNumber.from(await tokenDistributor.START_BLOCK()).add("24"));

      tx = await feeSharingSystem.connect(user1).withdrawAll(true);
      await expect(tx)
        .to.emit(feeSharingSystem, "Withdraw")
        .withArgs(user1.address, parseEther("287.5"), parseEther("60"));

      assert.deepEqual(await feeSharingSystem.rewardPerTokenStored(), parseEther("0.6"));
      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("10"));
      assert.deepEqual(await feeSharingSystem.totalShares(), parseEther("300"));

      const userInfo = await feeSharingSystem.userInfo(user1.address);
      assert.deepEqual(userInfo[0], constants.Zero);
      assert.deepEqual(userInfo[1], parseEther("0.6"));
      assert.deepEqual(userInfo[2], constants.Zero);

      // 2. Rewards are updated before the end so currentRewardPerBlock increases
      await advanceBlockTo(BigNumber.from(await feeSharingSystem.periodEndBlock()).sub("11"));

      tx = await feeSharingSystem.connect(admin).updateRewards(parseEther("200"), "10");

      await rewardToken.connect(admin).transfer(feeSharingSystem.address, parseEther("200"));

      assert.deepEqual(await feeSharingSystem.currentRewardPerBlock(), parseEther("30"));
    });
  });

  describe("#3 - Revertions", async () => {
    it("Cannot update rewards if no reward", async () => {
      await expect(feeSharingSetter.connect(admin).updateRewards()).to.be.revertedWith("Reward: Nothing to distribute");
    });

    it("Cannot update rewards if too early", async () => {
      await rewardToken.connect(admin).transfer(feeSharingSetter.address, parseEther("500"));
      await feeSharingSetter.connect(admin).updateRewards();
      await expect(feeSharingSetter.connect(admin).updateRewards()).to.be.revertedWith("Reward: Too early to add");
    });

    it("Cannot deposit if amount is less than 1", async () => {
      await expect(feeSharingSystem.connect(user1).deposit(parseEther("0.99999999999999"), true)).to.be.revertedWith(
        "Deposit: Amount must be >= 1 LOOKS"
      );

      await expect(feeSharingSystem.connect(user1).deposit(parseEther("1").sub("1"), true)).to.be.revertedWith(
        "Deposit: Amount must be >= 1 LOOKS"
      );
    });

    it("Cannot harvest if amount is 0", async () => {
      await expect(feeSharingSystem.connect(user1).harvest()).to.be.revertedWith(
        "Harvest: Pending rewards must be > 0"
      );
    });

    it("Cannot withdraw if amount is 0 or larger than user balance", async () => {
      await expect(feeSharingSystem.connect(user1).withdraw("0", false)).to.be.revertedWith(
        "Withdraw: Shares equal to 0 or larger than user shares"
      );

      await expect(feeSharingSystem.connect(user1).withdraw(parseEther("100.0000001"), false)).to.be.revertedWith(
        "Withdraw: Shares equal to 0 or larger than user shares"
      );
    });

    it("Cannot add/remove if no/wrong address", async () => {
      await expect(feeSharingSetter.connect(admin).removeFeeStakingAddresses([user1.address])).to.be.revertedWith(
        "Owner: Address not registered"
      );

      await feeSharingSetter.connect(admin).addFeeStakingAddresses([user1.address]);

      await expect(feeSharingSetter.connect(admin).addFeeStakingAddresses([user1.address])).to.be.revertedWith(
        "Owner: Address already registered"
      );
    });

    it("Can set new reward duration only if within the range range", async () => {
      const minimumDuration = await feeSharingSetter.MIN_REWARD_DURATION_IN_BLOCKS();
      const maximumDuration = await feeSharingSetter.MAX_REWARD_DURATION_IN_BLOCKS();

      let tx = await feeSharingSetter.connect(admin).setNewRewardDurationInBlocks(minimumDuration);
      await expect(tx).to.emit(feeSharingSetter, "NewRewardDurationInBlocks").withArgs(minimumDuration);

      tx = await feeSharingSetter.connect(admin).setNewRewardDurationInBlocks(maximumDuration);
      await expect(tx).to.emit(feeSharingSetter, "NewRewardDurationInBlocks").withArgs(maximumDuration);

      await expect(
        feeSharingSetter
          .connect(admin)
          .setNewRewardDurationInBlocks(BigNumber.from(minimumDuration).sub(BigNumber.from("1")))
      ).to.be.revertedWith("Owner: New reward duration in blocks outside of range");

      await expect(
        feeSharingSetter
          .connect(admin)
          .setNewRewardDurationInBlocks(BigNumber.from(maximumDuration).add(BigNumber.from("1")))
      ).to.be.revertedWith("Owner: New reward duration in blocks outside of range");
    });
  });

  describe("#3 - Owner", async () => {
    it("Can transfer ownership of FeeSharingSystem", async () => {
      assert.equal(await feeSharingSystem.owner(), feeSharingSetter.address);

      await expect(
        feeSharingSetter.connect(admin).transferOwnershipOfFeeSharingSystem(constants.AddressZero)
      ).to.be.revertedWith("Owner: New owner cannot be null address");

      const tx = await feeSharingSetter.connect(admin).transferOwnershipOfFeeSharingSystem(admin.address);
      await expect(tx).to.emit(feeSharingSetter, "NewFeeSharingSystemOwner").withArgs(admin.address);
      assert.equal(await feeSharingSystem.owner(), admin.address);
    });

    it("Cannot convert token if reward convertor not set ", async () => {
      await expect(
        feeSharingSetter
          .connect(admin)
          .convertCurrencyToRewardToken(looksRareToken.address, defaultAbiCoder.encode([], []))
      ).to.be.revertedWith("Convert: RewardConvertor not set");
    });

    it("Owner functions can only be called by owner", async () => {
      const ERROR_MESSAGE_DEFAULT_ADMIN_ROLE =
        "AccessControl: account " +
        String(user1.address).toLowerCase() +
        " is missing role 0x0000000000000000000000000000000000000000000000000000000000000000";

      const ERROR_MESSAGE_OPERATOR_ROLE =
        "AccessControl: account " +
        String(user1.address).toLowerCase() +
        " is missing role 0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929";

      await expect(feeSharingSetter.connect(user1).updateRewards()).to.be.revertedWith(ERROR_MESSAGE_OPERATOR_ROLE);

      await expect(
        feeSharingSetter.connect(user1).convertCurrencyToRewardToken(admin.address, defaultAbiCoder.encode([], []))
      ).to.be.revertedWith(ERROR_MESSAGE_OPERATOR_ROLE);

      await expect(feeSharingSetter.connect(user1).setNewRewardDurationInBlocks("300")).to.be.revertedWith(
        ERROR_MESSAGE_DEFAULT_ADMIN_ROLE
      );

      await expect(feeSharingSetter.connect(user1).setRewardConvertor(constants.AddressZero)).to.be.revertedWith(
        ERROR_MESSAGE_DEFAULT_ADMIN_ROLE
      );

      await expect(feeSharingSetter.connect(user1).addFeeStakingAddresses([user1.address])).to.be.revertedWith(
        ERROR_MESSAGE_DEFAULT_ADMIN_ROLE
      );

      await expect(feeSharingSetter.connect(user1).removeFeeStakingAddresses([user1.address])).to.be.revertedWith(
        ERROR_MESSAGE_DEFAULT_ADMIN_ROLE
      );

      await expect(
        feeSharingSetter.connect(user1).transferOwnershipOfFeeSharingSystem(user1.address)
      ).to.be.revertedWith(ERROR_MESSAGE_DEFAULT_ADMIN_ROLE);
    });
  });
});
