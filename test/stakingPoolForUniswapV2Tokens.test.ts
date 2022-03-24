import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { advanceBlockTo } from "./helpers/block-traveller";

const { parseEther } = utils;

describe("StakingPoolForUniswapV2Tokens", () => {
  let looksRareToken: Contract;
  let stakedToken: Contract;
  let stakingPoolForUniswapV2Tokens: Contract;

  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;

  let endBlock: BigNumber;
  let startBlock: BigNumber;
  let rewardPerBlock: BigNumber;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    admin = accounts[0];
    user1 = accounts[1];
    user2 = accounts[2];
    user3 = accounts[3];
    user4 = accounts[4];

    const premintAmount = parseEther("6250");
    const cap = parseEther("25000"); // 25,000 tokens

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    stakedToken = await MockERC20.deploy("Mock LP", "MLP");
    await stakedToken.deployed();

    await stakedToken.connect(admin).mint(admin.address, parseEther("1000000"));
    startBlock = BigNumber.from(await ethers.provider.getBlockNumber()).add("100");

    const LooksRareToken = await ethers.getContractFactory("LooksRareToken");
    looksRareToken = await LooksRareToken.deploy(admin.address, premintAmount, cap);
    await looksRareToken.deployed();

    endBlock = startBlock.add("400");
    rewardPerBlock = parseEther("10");

    const StakingPoolForUniswapV2Tokens = await ethers.getContractFactory("StakingPoolForUniswapV2Tokens");
    stakingPoolForUniswapV2Tokens = await StakingPoolForUniswapV2Tokens.deploy(
      stakedToken.address,
      looksRareToken.address,
      rewardPerBlock,
      startBlock,
      endBlock
    );
    await stakingPoolForUniswapV2Tokens.deployed();

    // Each user mints 1000 staked tokens but deposits 100 into the staking pool
    for (const user of [user1, user2, user3, user4]) {
      await stakedToken.connect(user).mint(user.address, parseEther("1000"));
      await stakedToken.connect(user).approve(stakingPoolForUniswapV2Tokens.address, constants.MaxUint256);
      await stakingPoolForUniswapV2Tokens.connect(user).deposit(parseEther("100"));
    }
  });

  describe("#1 - Regular user/admin interactions", async () => {
    it("All users can unstake to end of pool", async () => {
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("4000"));
      await advanceBlockTo(endBlock);

      for (const user of [user1, user2, user3, user4]) {
        await stakingPoolForUniswapV2Tokens.connect(user).withdraw(parseEther("100"));
      }

      assert.deepEqual(await looksRareToken.balanceOf(user1.address), await looksRareToken.balanceOf(user2.address));

      // Less than 0.000000001 LOOKS token is lost in precision
      assert.isAtMost(Number(await looksRareToken.balanceOf(stakingPoolForUniswapV2Tokens.address)), 1000000000);
    });

    it("Additional deposits don't harvest before rewards, harvest after rewards", async () => {
      // 400 * 10 = 4000
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("4000"));

      let tx = await stakingPoolForUniswapV2Tokens.connect(user1).deposit(parseEther("10"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Deposit")
        .withArgs(user1.address, parseEther("10"), parseEther("0"));

      await advanceBlockTo(startBlock.add(BigNumber.from("99")));

      // (110 * 10 * 100) / 410 = 268.29268292673
      tx = await stakingPoolForUniswapV2Tokens.connect(user1).deposit(parseEther("10"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Deposit")
        .withArgs(user1.address, parseEther("10"), parseEther("268.29268292673"));
    });

    it("User can deposit/withdraw/deposit before the start", async () => {
      let tx = await stakingPoolForUniswapV2Tokens.connect(user1).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user1.address, parseEther("100"), parseEther("0"));

      tx = await stakingPoolForUniswapV2Tokens.connect(user1).deposit(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Deposit")
        .withArgs(user1.address, parseEther("100"), parseEther("0"));
    });

    it("Users all withdraw, user deposits again after the start and before the end", async () => {
      // 400 * 10 = 4000
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("4000"));
      await advanceBlockTo(startBlock);

      // 20 / 4 = 5
      let tx = await stakingPoolForUniswapV2Tokens.connect(user1).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user1.address, parseEther("100"), parseEther("2.5"));

      // 5 + 10 / 3 = 5.8333333333
      tx = await stakingPoolForUniswapV2Tokens.connect(user2).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user2.address, parseEther("100"), parseEther("5.8333333333"));

      // 5.8333333333 + 10 / 2 = 10.8333333333
      tx = await stakingPoolForUniswapV2Tokens.connect(user3).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user3.address, parseEther("100"), parseEther("10.8333333333"));

      // 10.8333333333 + 10 / 1 = 20.8333333333
      tx = await stakingPoolForUniswapV2Tokens.connect(user4).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user4.address, parseEther("100"), parseEther("20.8333333333"));

      // New deposit kicks in (from user1)
      tx = await stakingPoolForUniswapV2Tokens.connect(user1).deposit(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Deposit")
        .withArgs(user1.address, parseEther("100"), parseEther("0"));

      // User1 collects the entire block reward
      tx = await stakingPoolForUniswapV2Tokens.connect(user1).deposit(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Deposit")
        .withArgs(user1.address, parseEther("100"), parseEther("10"));
    });

    it("Scenario #1 - Normal staking with one reward adjustment", async () => {
      // 10 * 10 = 100
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("100"));
      await advanceBlockTo(startBlock.add(BigNumber.from("9")));

      // 10 * 10 / 4 = 25
      let tx = await stakingPoolForUniswapV2Tokens.connect(user1).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user1.address, parseEther("100"), parseEther("25"));

      // 90 * 10 = 900
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("900"));
      await advanceBlockTo(startBlock.add(BigNumber.from("99")));

      // 25 + 90 * 10 / 3 = 325
      tx = await stakingPoolForUniswapV2Tokens.connect(user2).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user2.address, parseEther("100"), parseEther("325"));

      // 325 + 10 / 2 = 330
      tx = await stakingPoolForUniswapV2Tokens.connect(user3).harvest();
      await expect(tx).to.emit(stakingPoolForUniswapV2Tokens, "Harvest").withArgs(user3.address, parseEther("330"));

      // 50 * 10 = 500 // Advance to startBlock + 149
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("500"));
      await advanceBlockTo(startBlock.add(BigNumber.from("149")));

      // Admin updates endBlock and rewards to 5 LOOKS/block
      const newEndBlock = startBlock.add(BigNumber.from("300"));

      tx = await stakingPoolForUniswapV2Tokens
        .connect(admin)
        .updateRewardPerBlockAndEndBlock(parseEther("5"), newEndBlock);
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "NewRewardPerBlockAndEndBlock")
        .withArgs(parseEther("5"), newEndBlock);

      // 50 * 5 = 250 // Advance to startBlock + 199
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("250"));
      await advanceBlockTo(startBlock.add(BigNumber.from("199")));

      // 49 * 5 / 2 + 10 * 49 / 2 = 120 + 247.5 = 367.5
      assert.deepEqual(await stakingPoolForUniswapV2Tokens.calculatePendingRewards(user3.address), parseEther("367.5"));

      // 49 * 5 / 2 + 10 * 50 / 2 = 120 + 250 = 370
      tx = await stakingPoolForUniswapV2Tokens.connect(user3).harvest();
      await expect(tx).to.emit(stakingPoolForUniswapV2Tokens, "Harvest").withArgs(user3.address, parseEther("370"));

      // 500 // Advance to endBlock
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("500"));
      await advanceBlockTo(newEndBlock);

      // 100 * 5 / 2 = 250
      assert.deepEqual(await stakingPoolForUniswapV2Tokens.calculatePendingRewards(user3.address), parseEther("250"));

      tx = await stakingPoolForUniswapV2Tokens.connect(user3).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user3.address, parseEther("100"), parseEther("250"));

      // Harvested amount = sum of past harvested amounts for user3
      // harvestedAmount = 330 + 370 + 250 = 950
      assert.deepEqual(await stakingPoolForUniswapV2Tokens.calculatePendingRewards(user4.address), parseEther("950"));

      // User4 withdraws 75 LP tokens, gets the entire harvested amount (950 LOOKS)
      tx = await stakingPoolForUniswapV2Tokens.connect(user4).withdraw(parseEther("75"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user4.address, parseEther("75"), parseEther("950"));

      // User4 withdraws the remaining, nothing is harvested since rewards have stopped
      tx = await stakingPoolForUniswapV2Tokens.connect(user4).withdraw(parseEther("25"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user4.address, parseEther("25"), parseEther("0"));

      // Less than 0.000000001 LOOKS token
      assert.isAtMost(Number(await looksRareToken.balanceOf(stakingPoolForUniswapV2Tokens.address)), 1000000000);
    });

    it("Scenario #2 - Staking with one adjustment and a few emergency withdraws", async () => {
      // 10 * 10 = 100 // Advance to startBlock + 9
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("100"));
      await advanceBlockTo(startBlock.add(BigNumber.from("9")));

      // Admin pauses
      await stakingPoolForUniswapV2Tokens.pause();

      // 10 * 10 / 4 = 25 are given up by user1
      let tx = await stakingPoolForUniswapV2Tokens.connect(user1).emergencyWithdraw();
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "EmergencyWithdraw")
        .withArgs(user1.address, parseEther("100"));

      // Admin unpauses
      await stakingPoolForUniswapV2Tokens.unpause();

      // 90 * 10 = 900 / Advance to startBlock + 99
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("900"));
      await advanceBlockTo(startBlock.add(BigNumber.from("99")));

      //  100 * 10 / 3 = 333.3333333333 (precision is 10e12)
      tx = await stakingPoolForUniswapV2Tokens.connect(user2).withdraw(parseEther("100"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user2.address, parseEther("100"), parseEther("333.3333333333"));

      // 333.3333333333 + 10 / 2 = 338.3333333333
      tx = await stakingPoolForUniswapV2Tokens.connect(user3).harvest();
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Harvest")
        .withArgs(user3.address, parseEther("338.3333333333"));

      // 50 * 10 = 500 // Advance to startBlock + 149
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("500"));
      await advanceBlockTo(startBlock.add(BigNumber.from("149")));

      // Admin updates endBlock and rewards to 5 LOOKS/block
      const newEndBlock = startBlock.add(BigNumber.from("300"));

      tx = await stakingPoolForUniswapV2Tokens.updateRewardPerBlockAndEndBlock(
        parseEther("5").toString(),
        newEndBlock.toString()
      );
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "NewRewardPerBlockAndEndBlock")
        .withArgs(parseEther("5"), newEndBlock);

      // 50 * 5 = 250 // Advance to startBlock + 199
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("250"));
      await advanceBlockTo(startBlock.add(BigNumber.from("199")));

      // 49 * 5 / 2 + 10 * 49 / 2 = 120 + 247.5 = 367.5
      assert.deepEqual(await stakingPoolForUniswapV2Tokens.calculatePendingRewards(user3.address), parseEther("367.5"));

      // 49 * 5 / 2 + 10 * 50 / 2 = 120 + 250 = 370
      tx = await stakingPoolForUniswapV2Tokens.connect(user3).harvest();
      await expect(tx).to.emit(stakingPoolForUniswapV2Tokens, "Harvest").withArgs(user3.address, parseEther("370"));

      // 100 * 5 = 500 // Advance to newEndBlock
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("500"));
      await advanceBlockTo(newEndBlock);

      // 100 * 5 / 2 = 250 reward tokens are pending for user3
      assert.deepEqual(await stakingPoolForUniswapV2Tokens.calculatePendingRewards(user3.address), parseEther("250"));

      // Harvested amount = sum of past/expected harvested amounts for user3
      // harvestedAmount = 338.3333333333 + 370 + 250 = 958.3333333333
      assert.deepEqual(
        await stakingPoolForUniswapV2Tokens.calculatePendingRewards(user4.address),
        parseEther("958.3333333333")
      );

      // Admin pauses
      await stakingPoolForUniswapV2Tokens.connect(admin).pause();

      // User3 decides to call emergency withdraw and gives up 250 tokens
      tx = await stakingPoolForUniswapV2Tokens.connect(user3).emergencyWithdraw();
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "EmergencyWithdraw")
        .withArgs(user3.address, parseEther("100"));

      // User4 gets the rewards from user3 (250 tokens in addition to before)
      // 958.3333333333 + 250 = 1208.3333333333
      assert.deepEqual(
        await stakingPoolForUniswapV2Tokens.calculatePendingRewards(user4.address),
        parseEther("1208.3333333333")
      );

      // User4 withdraws 75 LP tokens, gets the entire harvested amount
      tx = await stakingPoolForUniswapV2Tokens.connect(user4).withdraw(parseEther("75"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user4.address, parseEther("75"), parseEther("1208.3333333333"));

      // User4 withdraws the remaining, nothing is harvested since rewards have stopped
      tx = await stakingPoolForUniswapV2Tokens.connect(user4).withdraw(parseEther("25"));
      await expect(tx)
        .to.emit(stakingPoolForUniswapV2Tokens, "Withdraw")
        .withArgs(user4.address, parseEther("25"), parseEther("0"));

      // Less than 0.000000001 LOOKS token
      assert.isAtMost(Number(await looksRareToken.balanceOf(stakingPoolForUniswapV2Tokens.address)), 1000000000);
    });
  });

  describe("#2 - Owner functions", async () => {
    it("Owner functions work as expected", async () => {
      await looksRareToken.connect(admin).transfer(stakingPoolForUniswapV2Tokens.address, parseEther("10"));

      const tx = await stakingPoolForUniswapV2Tokens.connect(admin).adminRewardWithdraw(parseEther("10"));
      await expect(tx).to.emit(stakingPoolForUniswapV2Tokens, "AdminRewardWithdraw").withArgs(parseEther("10"));
    });

    it("Owner functions revert as expected", async () => {
      await expect(
        stakingPoolForUniswapV2Tokens.updateRewardPerBlockAndEndBlock(parseEther("5"), startBlock)
      ).to.be.revertedWith("Owner: New endBlock must be after start block");

      await expect(
        stakingPoolForUniswapV2Tokens.updateRewardPerBlockAndEndBlock(parseEther("5"), "0")
      ).to.be.revertedWith("Owner: New endBlock must be after current block");
    });
  });

  describe("#3 - User revertions", async () => {
    it("Cannot deposit if amount is 0", async () => {
      await expect(stakingPoolForUniswapV2Tokens.connect(user1).deposit("0")).to.be.revertedWith(
        "Deposit: Amount must be > 0"
      );
    });

    it("Cannot harvest if amount is 0", async () => {
      await expect(stakingPoolForUniswapV2Tokens.connect(user1).harvest()).to.be.revertedWith(
        "Harvest: Pending rewards must be > 0"
      );
    });

    it("Cannot emergency withdraw if amount is 0", async () => {
      await stakingPoolForUniswapV2Tokens.connect(admin).pause();
      await expect(stakingPoolForUniswapV2Tokens.connect(admin).emergencyWithdraw()).to.be.revertedWith(
        "Withdraw: Amount must be > 0"
      );
    });

    it("Cannot withdraw if amount is 0 or larger than user balance", async () => {
      await expect(stakingPoolForUniswapV2Tokens.connect(user1).withdraw("0")).to.be.revertedWith(
        "Withdraw: Amount must be > 0 or lower than user balance"
      );

      await expect(stakingPoolForUniswapV2Tokens.connect(user1).withdraw(parseEther("100.0000001"))).to.be.revertedWith(
        "Withdraw: Amount must be > 0 or lower than user balance"
      );
    });
  });
});
