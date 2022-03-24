import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { advanceBlockTo } from "./helpers/block-traveller";

const { parseEther } = utils;

describe("VestingContractWithFeeSharing", () => {
  let looksRareToken: Contract;
  let weth: Contract;
  let vestingContract: Contract;

  let admin: SignerWithAddress;
  let randomUser: SignerWithAddress;

  let maxAmountToWithdraw: BigNumber;
  let numberUnlockPeriods: BigNumber;
  let startBlock: BigNumber;
  let vestingBetweenPeriodsInBlocks: BigNumber;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    admin = accounts[0];
    randomUser = accounts[1];

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    looksRareToken = await MockERC20.deploy("LOOKS", "Mock LOOKS");
    await looksRareToken.deployed();
    weth = await MockERC20.deploy("WETH", "Wrapped ETH");
    await weth.deployed();

    await looksRareToken.connect(admin).mint(admin.address, parseEther("100000000"));
    await weth.connect(admin).mint(admin.address, parseEther("100000000"));

    maxAmountToWithdraw = parseEther("500000"); // 500,000

    startBlock = BigNumber.from(await ethers.provider.getBlockNumber()).add("100");
    vestingBetweenPeriodsInBlocks = BigNumber.from("50");
    numberUnlockPeriods = BigNumber.from("4");

    const VestingContractWithFeeSharing = await ethers.getContractFactory("VestingContractWithFeeSharing");
    vestingContract = await VestingContractWithFeeSharing.deploy(
      vestingBetweenPeriodsInBlocks,
      startBlock,
      numberUnlockPeriods,
      maxAmountToWithdraw,
      looksRareToken.address
    );
    await vestingContract.deployed();
  });

  describe("#1 - System works as expected", async () => {
    it("Release tokens work", async () => {
      await weth.connect(admin).transfer(vestingContract.address, parseEther("20"));

      let tx = await vestingContract.connect(admin).withdrawOtherCurrency(weth.address);
      await expect(tx).to.emit(vestingContract, "OtherTokensWithdrawn").withArgs(weth.address, parseEther("20"));

      // Transfer 500k LOOKS to Vesting Contract
      await looksRareToken.connect(admin).transfer(vestingContract.address, maxAmountToWithdraw);

      // Cannot unlock since it is too early
      await expect(vestingContract.unlockLooksRareToken()).to.be.revertedWith("Unlock: Too early");

      // Time travel
      await advanceBlockTo(BigNumber.from(startBlock.add(vestingBetweenPeriodsInBlocks)));

      // Admin unlocks tokens
      tx = await vestingContract.connect(admin).unlockLooksRareToken();
      await expect(tx).to.emit(vestingContract, "TokensUnlocked").withArgs(maxAmountToWithdraw);

      // Verify next period, maxAmountToWithdrawForNextPeriod are adjusted accordingly
      assert.equal((await vestingContract.numberPastUnlocks()).toString(), "1");
      assert.deepEqual(await vestingContract.maxAmountToWithdrawForNextPeriod(), maxAmountToWithdraw);
      assert.deepEqual(
        await vestingContract.nextBlockForUnlock(),
        startBlock.add(vestingBetweenPeriodsInBlocks).add(vestingBetweenPeriodsInBlocks)
      );

      // PERIOD 2 // Transfer less than expected (400k LOOKS) to Vesting Contract
      let nextBlockForUnlock = await vestingContract.nextBlockForUnlock();
      await advanceBlockTo(nextBlockForUnlock);
      await looksRareToken.connect(admin).transfer(vestingContract.address, parseEther("400000"));

      // Admin unlocks tokens
      tx = await vestingContract.connect(admin).unlockLooksRareToken();
      await expect(tx).to.emit(vestingContract, "TokensUnlocked").withArgs(parseEther("400000"));

      // Verify next period, maxAmountToWithdrawForNextPeriod are adjusted accordingly
      assert.equal((await vestingContract.numberPastUnlocks()).toString(), "2");
      assert.deepEqual(await vestingContract.maxAmountToWithdrawForNextPeriod(), parseEther("600000"));

      // PERIOD 3 - Transfer more than expected (1M LOOKS) to Vesting Contract
      nextBlockForUnlock = await vestingContract.nextBlockForUnlock();
      await advanceBlockTo(nextBlockForUnlock);
      await looksRareToken.connect(admin).transfer(vestingContract.address, parseEther("1000000"));

      // Admin unlocks tokens
      tx = await vestingContract.connect(admin).unlockLooksRareToken();
      await expect(tx).to.emit(vestingContract, "TokensUnlocked").withArgs(parseEther("600000"));

      // Verify next period, maxAmountToWithdrawForNextPeriod are adjusted accordingly
      assert.equal((await vestingContract.numberPastUnlocks()).toString(), "3");
      assert.deepEqual(await vestingContract.maxAmountToWithdrawForNextPeriod(), parseEther("500000"));

      // PERIOD 4 - Transfer what is missing for final period (100k LOOKS) to Vesting Contract
      nextBlockForUnlock = await vestingContract.nextBlockForUnlock();
      await advanceBlockTo(nextBlockForUnlock);
      await looksRareToken.transfer(vestingContract.address, parseEther("100000"));

      // Admin unlocks tokens
      tx = await vestingContract.connect(admin).unlockLooksRareToken();
      await expect(tx).to.emit(vestingContract, "TokensUnlocked").withArgs(maxAmountToWithdraw);

      // Verify number of past unlocks period is adjusted accordingly
      assert.equal((await vestingContract.numberPastUnlocks()).toString(), "4");

      // AFTER - Can claim anything that comes in
      await looksRareToken.connect(admin).transfer(vestingContract.address, "100");
      tx = await vestingContract.connect(admin).unlockLooksRareToken();
      await expect(tx).to.emit(vestingContract, "TokensUnlocked").withArgs("100");
    });

    it("Cannot withdraw LOOKS using standard withdraw functions", async () => {
      await expect(vestingContract.connect(admin).withdrawOtherCurrency(looksRareToken.address)).to.be.revertedWith(
        "Owner: Cannot withdraw LOOKS"
      );

      await expect(vestingContract.connect(admin).withdrawOtherCurrency(weth.address)).to.be.revertedWith(
        "Owner: Nothing to withdraw"
      );
    });
  });

  describe("#2 - Owner functions can only be called by owner", async () => {
    it("Owner functions are only callable by owner", async () => {
      await expect(
        vestingContract.connect(randomUser).withdrawOtherCurrency(looksRareToken.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(vestingContract.connect(randomUser).unlockLooksRareToken()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});
