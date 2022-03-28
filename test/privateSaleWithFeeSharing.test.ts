import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { advanceBlockTo } from "./helpers/block-traveller";

const { parseEther } = utils;

describe("PrivateSaleWithFeeSharing", () => {
  let looksRareToken: Contract;
  let privateSale: Contract;
  let weth: Contract;

  let admin: SignerWithAddress;
  let firstTierUsers: SignerWithAddress[];
  let secondTierUsers: SignerWithAddress[];
  let thirdTierUsers: SignerWithAddress[];

  let firstTierUserAddresses: string[];
  let secondTierUserAddresses: string[];
  let thirdTierUserAddresses: string[];

  let firstTierUser1: SignerWithAddress;
  let firstTierUser2: SignerWithAddress;
  let firstTierUser3: SignerWithAddress;
  let firstTierUser4: SignerWithAddress;
  let firstTierUser5: SignerWithAddress;
  let secondTierUser1: SignerWithAddress;
  let secondTierUser2: SignerWithAddress;
  let secondTierUser3: SignerWithAddress;
  let secondTierUser4: SignerWithAddress;
  let secondTierUser5: SignerWithAddress;
  let thirdTierUser1: SignerWithAddress;
  let thirdTierUser2: SignerWithAddress;
  let thirdTierUser3: SignerWithAddress;
  let thirdTierUser4: SignerWithAddress;
  let thirdTierUser5: SignerWithAddress;
  let randomUser: SignerWithAddress;

  let totalLooksDistributed: BigNumber;
  let allocationCostFirstTier: BigNumber;
  let allocationCostSecondTier: BigNumber;
  let allocationCostThirdTier: BigNumber;
  let blockForWithdrawal: BigNumber;
  let maxBlockForWithdrawal: BigNumber;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    admin = accounts[0];
    firstTierUser1 = accounts[1];
    firstTierUser2 = accounts[2];
    firstTierUser3 = accounts[3];
    firstTierUser4 = accounts[4];
    firstTierUser5 = accounts[5];
    secondTierUser1 = accounts[6];
    secondTierUser2 = accounts[7];
    secondTierUser3 = accounts[8];
    secondTierUser4 = accounts[9];
    secondTierUser5 = accounts[10];
    thirdTierUser1 = accounts[11];
    thirdTierUser2 = accounts[12];
    thirdTierUser3 = accounts[13];
    thirdTierUser4 = accounts[14];
    thirdTierUser5 = accounts[15];
    randomUser = accounts[16];

    firstTierUsers = [firstTierUser1, firstTierUser2, firstTierUser3, firstTierUser4, firstTierUser5];
    secondTierUsers = [secondTierUser1, secondTierUser2, secondTierUser3, secondTierUser4, secondTierUser5];
    thirdTierUsers = [thirdTierUser1, thirdTierUser2, thirdTierUser3, thirdTierUser4, thirdTierUser5];

    firstTierUserAddresses = firstTierUsers.map((x) => x.address);
    secondTierUserAddresses = secondTierUsers.map((x) => x.address);
    thirdTierUserAddresses = thirdTierUsers.map((x) => x.address);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    looksRareToken = await MockERC20.deploy("LooksRare Token", "LOOKS");
    await looksRareToken.deployed();
    weth = await MockERC20.deploy("WETH", "WETH");
    await weth.deployed();

    totalLooksDistributed = parseEther("3500000"); // 3.5M of LOOKS

    await looksRareToken.connect(admin).mint(admin.address, totalLooksDistributed);
    await weth.connect(admin).mint(admin.address, parseEther("100000"));

    maxBlockForWithdrawal = BigNumber.from(await ethers.provider.getBlockNumber()).add("50000");
    blockForWithdrawal = maxBlockForWithdrawal;

    const PrivateSaleWithFeeSharing = await ethers.getContractFactory("PrivateSaleWithFeeSharing");
    privateSale = await PrivateSaleWithFeeSharing.deploy(
      looksRareToken.address,
      weth.address,
      blockForWithdrawal,
      totalLooksDistributed
    );
    await privateSale.deployed();

    // Set up allocation costs
    allocationCostFirstTier = parseEther("10");
    allocationCostSecondTier = parseEther("30");
    allocationCostThirdTier = parseEther("100");

    // 5 * 10 = 50 ETH
    let tx = await privateSale.connect(admin).setAllocationCostPerTier("1", allocationCostFirstTier);
    await expect(tx)
      .to.emit(privateSale, "NewAllocationCostPerTier")
      .withArgs(BigNumber.from("1"), allocationCostFirstTier);

    // 5 * 30 = 150 ETH
    tx = await privateSale.connect(admin).setAllocationCostPerTier("2", allocationCostSecondTier);
    await expect(tx)
      .to.emit(privateSale, "NewAllocationCostPerTier")
      .withArgs(BigNumber.from("2"), allocationCostSecondTier);

    // 5 * 100 - 500 ETH
    tx = await privateSale.connect(admin).setAllocationCostPerTier("3", allocationCostThirdTier);
    await expect(tx)
      .to.emit(privateSale, "NewAllocationCostPerTier")
      .withArgs(BigNumber.from("3"), allocationCostThirdTier);

    // Total is 700 ETH --> 700 * 5000 = 3.5M LOOKS
    tx = await privateSale.connect(admin).setPriceOfETHInLOOKS("5000");
    await expect(tx).to.emit(privateSale, "NewPriceOfETHInLOOKS").withArgs("5000");
  });

  describe("#1 - Regular sales", async () => {
    it("Full sale process takes place as expected", async () => {
      blockForWithdrawal = BigNumber.from(await ethers.provider.getBlockNumber()).add("1000");

      let tx = await privateSale.connect(admin).setBlockForWithdrawal(blockForWithdrawal);
      await expect(tx).to.emit(privateSale, "NewBlockForWithdrawal").withArgs(blockForWithdrawal);

      tx = await privateSale.connect(admin).whitelistUsers(firstTierUserAddresses, "1");
      await expect(tx).to.emit(privateSale, "UsersWhitelisted").withArgs(firstTierUserAddresses, BigNumber.from("1"));
      assert.equal(await privateSale.numberOfParticipantsForATier("1"), "5");

      tx = await privateSale.connect(admin).whitelistUsers(secondTierUserAddresses, "2");
      await expect(tx).to.emit(privateSale, "UsersWhitelisted").withArgs(secondTierUserAddresses, BigNumber.from("2"));
      assert.equal(await privateSale.numberOfParticipantsForATier("2"), "5");

      tx = await privateSale.connect(admin).whitelistUsers(thirdTierUserAddresses, "3");
      await expect(tx).to.emit(privateSale, "UsersWhitelisted").withArgs(thirdTierUserAddresses, BigNumber.from("3"));
      assert.equal(await privateSale.numberOfParticipantsForATier("3"), "5");

      assert.deepEqual(await privateSale.getMaxAmountLOOKSToDistribute(), totalLooksDistributed);

      await looksRareToken.connect(admin).transfer(privateSale.address, totalLooksDistributed);
      assert.deepEqual(await looksRareToken.balanceOf(privateSale.address), totalLooksDistributed);

      // Open the deposit phases
      tx = await privateSale.connect(admin).updateSalePhase("1");
      await expect(tx).to.emit(privateSale, "NewSalePhase").withArgs(BigNumber.from("1"));

      // Users deposit
      for (const user of firstTierUsers) {
        tx = await privateSale.connect(user).deposit({ value: allocationCostFirstTier });
        await expect(tx).to.emit(privateSale, "Deposit").withArgs(user.address, BigNumber.from("1"));
      }

      for (const user of secondTierUsers) {
        tx = await privateSale.connect(user).deposit({ value: allocationCostSecondTier });
        await expect(tx).to.emit(privateSale, "Deposit").withArgs(user.address, BigNumber.from("2"));
      }

      for (const user of thirdTierUsers) {
        tx = await privateSale.connect(user).deposit({ value: allocationCostThirdTier });
        await expect(tx).to.emit(privateSale, "Deposit").withArgs(user.address, BigNumber.from("3"));
      }

      // 2. Owner updates sale status to withdrawal (pre-staking)
      tx = await privateSale.connect(admin).updateSalePhase("2");
      await expect(tx).to.emit(privateSale, "NewSalePhase").withArgs(BigNumber.from("2"));

      // 3. Owner withdraws ethers (it also updates sale status to staking)
      tx = await privateSale.connect(admin).withdrawCommittedAmount();
      await expect(tx).to.emit(privateSale, "NewSalePhase").withArgs(BigNumber.from("3"));

      // It shouldn't emit a transfer event since there is no surplus of LOOKS
      await expect(tx).not.to.emit(looksRareToken, "Transfer");

      // 4. Staking phase starts
      // 4.1 Owner deposits 10 WETH
      const firstDepositAmount = parseEther("10");
      await weth.connect(admin).transfer(privateSale.address, firstDepositAmount);

      // First tier user1 user harvest
      const expectedHarvestAmountForTier1 = firstDepositAmount
        .mul(BigNumber.from(await privateSale.allocationCostPerTier("1")))
        .div(BigNumber.from(await privateSale.totalAmountCommitted()));

      tx = await privateSale.connect(firstTierUser1).harvest();
      await expect(tx).to.emit(privateSale, "Harvest").withArgs(firstTierUser1.address, expectedHarvestAmountForTier1);
      assert.notDeepEqual(
        await privateSale.calculatePendingRewards(firstTierUser1.address),
        expectedHarvestAmountForTier1
      );

      await expect(privateSale.connect(firstTierUser1).harvest()).to.be.revertedWith("Harvest: Nothing to transfer");

      // Second tier user1 user harvest
      const expectedHarvestAmountForTier2 = firstDepositAmount
        .mul(BigNumber.from(await privateSale.allocationCostPerTier("2")))
        .div(BigNumber.from(await privateSale.totalAmountCommitted()));

      tx = await privateSale.connect(secondTierUser1).harvest();
      await expect(tx).to.emit(privateSale, "Harvest").withArgs(secondTierUser1.address, expectedHarvestAmountForTier2);

      await expect(privateSale.connect(secondTierUser1).harvest()).to.be.revertedWith("Harvest: Nothing to transfer");

      // Third tier user1 harvest
      const expectedHarvestAmountForTier3 = firstDepositAmount
        .mul(BigNumber.from(await privateSale.allocationCostPerTier("3")))
        .div(BigNumber.from(await privateSale.totalAmountCommitted()));

      tx = await privateSale.connect(thirdTierUser1).harvest();
      await expect(tx).to.emit(privateSale, "Harvest").withArgs(thirdTierUser1.address, expectedHarvestAmountForTier3);

      await expect(privateSale.connect(thirdTierUser1).harvest()).to.be.revertedWith("Harvest: Nothing to transfer");

      // 4.2 Admin deposits 18 WETH
      const secondDepositAmount = parseEther("18");
      await weth.connect(admin).transfer(privateSale.address, secondDepositAmount);

      const totalDepositAmount = firstDepositAmount.add(secondDepositAmount);

      const expectedHarvestAmountForTier1Step2 = totalDepositAmount
        .mul(BigNumber.from(await privateSale.allocationCostPerTier("1")))
        .div(BigNumber.from(await privateSale.totalAmountCommitted()));

      const expectedHarvestAmountForTier2Step2 = totalDepositAmount
        .mul(BigNumber.from(await privateSale.allocationCostPerTier("2")))
        .div(BigNumber.from(await privateSale.totalAmountCommitted()));

      const expectedHarvestAmountForTier3Step2 = totalDepositAmount
        .mul(BigNumber.from(await privateSale.allocationCostPerTier("3")))
        .div(BigNumber.from(await privateSale.totalAmountCommitted()));

      // First tier user2 can harvest the full amount
      tx = await privateSale.connect(firstTierUser2).harvest();
      await expect(tx)
        .to.emit(privateSale, "Harvest")
        .withArgs(firstTierUser2.address, expectedHarvestAmountForTier1Step2);

      // First tier user1 can harvest but she receives only the second set of rewards
      tx = await privateSale.connect(firstTierUser1).harvest();
      await expect(tx)
        .to.emit(privateSale, "Harvest")
        .withArgs(firstTierUser1.address, expectedHarvestAmountForTier1Step2.sub(expectedHarvestAmountForTier1));

      // Second tier user2 can harvest the full amount
      tx = await privateSale.connect(secondTierUser2).harvest();
      await expect(tx)
        .to.emit(privateSale, "Harvest")
        .withArgs(secondTierUser2.address, expectedHarvestAmountForTier2Step2);

      // Second tier user1 can harvest but she receives only the second set of rewards
      tx = await privateSale.connect(secondTierUser1).harvest();
      await expect(tx)
        .to.emit(privateSale, "Harvest")
        .withArgs(secondTierUser1.address, expectedHarvestAmountForTier2Step2.sub(expectedHarvestAmountForTier2));

      // Third tier user2 can harvest the full amount
      tx = await privateSale.connect(thirdTierUser2).harvest();
      await expect(tx)
        .to.emit(privateSale, "Harvest")
        .withArgs(thirdTierUser2.address, expectedHarvestAmountForTier3Step2);

      // Third tier user1 can harvest but she receives only the second set of rewards
      tx = await privateSale.connect(thirdTierUser1).harvest();
      await expect(tx)
        .to.emit(privateSale, "Harvest")
        .withArgs(thirdTierUser1.address, expectedHarvestAmountForTier3Step2.sub(expectedHarvestAmountForTier3));

      // User 1/2 for first/second/third tier cannot harvest again
      for (const user of [
        firstTierUser1,
        firstTierUser2,
        secondTierUser1,
        secondTierUser2,
        thirdTierUser1,
        thirdTierUser2,
      ]) {
        await expect(privateSale.connect(user).harvest()).to.be.revertedWith("Harvest: Nothing to transfer");
      }

      // 5. Withdrawal phase starts
      await advanceBlockTo(blockForWithdrawal);

      const amountLOOKSForTier1 = (await privateSale.priceOfETHInLOOKS()).mul(
        await privateSale.allocationCostPerTier("1")
      );

      const amountLOOKSForTier2 = (await privateSale.priceOfETHInLOOKS()).mul(
        await privateSale.allocationCostPerTier("2")
      );

      const amountLOOKSForTier3 = (await privateSale.priceOfETHInLOOKS()).mul(
        await privateSale.allocationCostPerTier("3")
      );

      tx = await privateSale.connect(firstTierUser1).updateSalePhaseToWithdraw();
      await expect(tx).to.emit(privateSale, "NewSalePhase").withArgs(BigNumber.from("4"));

      for (const user of firstTierUsers) {
        tx = await privateSale.connect(user).withdraw();
        await expect(tx)
          .to.emit(privateSale, "Withdraw")
          .withArgs(user.address, BigNumber.from("1"), amountLOOKSForTier1);

        if (user !== firstTierUser1 && user !== firstTierUser2) {
          await expect(tx).to.emit(privateSale, "Harvest").withArgs(user.address, expectedHarvestAmountForTier1Step2);
        } else {
          await expect(tx).to.not.emit(privateSale, "Harvest");
        }
      }

      for (const user of secondTierUsers) {
        tx = await privateSale.connect(user).withdraw();
        await expect(tx)
          .to.emit(privateSale, "Withdraw")
          .withArgs(user.address, BigNumber.from("2"), amountLOOKSForTier2);

        if (user !== secondTierUser1 && user !== secondTierUser2) {
          await expect(tx).to.emit(privateSale, "Harvest").withArgs(user.address, expectedHarvestAmountForTier2Step2);
        } else {
          await expect(tx).to.not.emit(privateSale, "Harvest");
        }
      }

      for (const user of thirdTierUsers) {
        tx = await privateSale.connect(user).withdraw();
        await expect(tx)
          .to.emit(privateSale, "Withdraw")
          .withArgs(user.address, BigNumber.from("3"), amountLOOKSForTier3);

        if (user !== thirdTierUser1 && user !== thirdTierUser2) {
          await expect(tx).to.emit(privateSale, "Harvest").withArgs(user.address, expectedHarvestAmountForTier3Step2);
        } else {
          await expect(tx).to.not.emit(privateSale, "Harvest");
        }
      }

      assert.deepEqual(await looksRareToken.balanceOf(privateSale.address), constants.Zero);
    });
  });

  describe("#2 - Reversion and risk checks work as expected", async () => {
    it("Pending phase / Risk checks work as expected", async () => {
      blockForWithdrawal = BigNumber.from(await ethers.provider.getBlockNumber()).add("1000");

      await privateSale.connect(admin).setBlockForWithdrawal(blockForWithdrawal);

      await expect(privateSale.connect(admin).updateSalePhase("0")).to.be.revertedWith(
        "Owner: Cannot update to this phase"
      );
      await expect(privateSale.connect(admin).updateSalePhase("2")).to.be.revertedWith("Owner: Phase must be Deposit");
      await expect(privateSale.connect(admin).updateSalePhase("3")).to.be.revertedWith(
        "Owner: Cannot update to this phase"
      );
      await expect(privateSale.connect(admin).updateSalePhase("4")).to.be.revertedWith(
        "Owner: Cannot update to this phase"
      );

      // Cannot set to wrong tiers
      await expect(privateSale.connect(admin).setAllocationCostPerTier("4", "100")).to.be.revertedWith(
        "Owner: Tier outside of range"
      );
      await expect(privateSale.connect(admin).setAllocationCostPerTier("0", "100")).to.be.revertedWith(
        "Owner: Tier outside of range"
      );
      await expect(privateSale.connect(admin).whitelistUsers([admin.address], "0")).to.be.revertedWith(
        "Owner: Tier outside of range"
      );
      await expect(privateSale.connect(admin).whitelistUsers([admin.address], "4")).to.be.revertedWith(
        "Owner: Tier outside of range"
      );

      // Cannot whitelist user is tier is already set
      await expect(
        privateSale.connect(admin).whitelistUsers([firstTierUser1.address, firstTierUser1.address], "1")
      ).to.be.revertedWith("Owner: Tier already set");

      // Cannot remove user is tier is not set
      await expect(privateSale.connect(admin).removeUserFromWhitelist(firstTierUser1.address)).to.be.revertedWith(
        "Owner: Tier not set for user"
      );

      // 1. Price is set at 0
      await privateSale.connect(admin).setPriceOfETHInLOOKS("0");
      await expect(privateSale.connect(admin).updateSalePhase("1")).to.be.revertedWith(
        "Owner: Exchange rate must be > 0"
      );

      // Price is set at 5000 again
      await privateSale.connect(admin).setPriceOfETHInLOOKS("5000");

      // 2. Amount expected don't match
      await expect(privateSale.connect(admin).updateSalePhase("1")).to.be.revertedWith("Owner: Wrong amount of LOOKS");

      // Too many users
      const tierUsers = [
        thirdTierUser1,
        thirdTierUser2,
        thirdTierUser3,
        thirdTierUser4,
        thirdTierUser5,
        firstTierUser1,
        firstTierUser2,
        firstTierUser3,
      ].map((x) => x.address);

      await privateSale.connect(admin).whitelistUsers(tierUsers, "3");

      // 3. Amount expected don't match because too many users are whitelisted
      assert.notDeepEqual(
        await privateSale.getMaxAmountLOOKSToDistribute(),
        await privateSale.TOTAL_LOOKS_DISTRIBUTED()
      );

      await expect(privateSale.connect(admin).updateSalePhase("1")).to.be.revertedWith("Owner: Wrong amount of LOOKS");

      // Users in wrong tier are removed from whitelist
      await privateSale.connect(admin).removeUserFromWhitelist(firstTierUser1.address);
      await privateSale.connect(admin).removeUserFromWhitelist(firstTierUser2.address);
      await privateSale.connect(admin).removeUserFromWhitelist(firstTierUser3.address);

      // Users are added in tier1/tier2
      await privateSale.connect(admin).whitelistUsers(firstTierUserAddresses, "1");
      await privateSale.connect(admin).whitelistUsers(secondTierUserAddresses, "2");

      assert.deepEqual(await privateSale.getMaxAmountLOOKSToDistribute(), await privateSale.TOTAL_LOOKS_DISTRIBUTED());

      // 4. LOOKS have not been transferred at all
      await expect(privateSale.connect(admin).updateSalePhase("1")).to.be.revertedWith(
        "Owner: Not enough LOOKS in the contract"
      );

      // Transfer LOOKS tokens (but a little less)
      await looksRareToken.connect(admin).transfer(privateSale.address, totalLooksDistributed.sub(BigNumber.from("1")));

      // Not enough LOOKS have been transferred
      await expect(privateSale.connect(admin).updateSalePhase("1")).to.be.revertedWith(
        "Owner: Not enough LOOKS in the contract"
      );

      // Transfer the missing 1 wei of LOOKS
      await looksRareToken.connect(admin).transfer(privateSale.address, BigNumber.from("1"));

      // 5. Wrong block for withdrawal for sale participants
      await privateSale.connect(admin).setBlockForWithdrawal("0");

      await expect(privateSale.connect(admin).updateSalePhase("1")).to.be.revertedWith(
        "Owner: Block for withdrawal wrongly set"
      );

      // Block for withdrawal is set to be higher than current block
      await privateSale.connect(admin).setBlockForWithdrawal(blockForWithdrawal);

      // After everything is adjusted, the private sale can start for deposits
      const tx = await privateSale.connect(admin).updateSalePhase("1");
      await expect(tx).to.emit(privateSale, "NewSalePhase").withArgs(BigNumber.from("1"));
    });

    it("Deposit phase / Risk checks work as expected", async () => {
      await expect(privateSale.connect(firstTierUser1).deposit({ value: allocationCostThirdTier })).to.be.revertedWith(
        "Deposit: Phase must be Deposit"
      );

      // Set up for phase 1
      blockForWithdrawal = BigNumber.from(await ethers.provider.getBlockNumber()).add("1000");
      await privateSale.connect(admin).setBlockForWithdrawal(blockForWithdrawal);

      await privateSale.connect(admin).whitelistUsers(firstTierUserAddresses, "1");
      await privateSale.connect(admin).whitelistUsers(secondTierUserAddresses, "2");
      await privateSale.connect(admin).whitelistUsers(thirdTierUserAddresses, "3");

      await looksRareToken.transfer(privateSale.address, totalLooksDistributed);
      await privateSale.connect(admin).updateSalePhase("1");

      // 1. User cannot deposit with wrong amounts (0, lower, high)
      await expect(privateSale.connect(firstTierUser1).deposit({ value: "0" })).to.be.revertedWith(
        "Deposit: Wrong amount"
      );
      await expect(privateSale.connect(firstTierUser1).deposit({ value: "1000000" })).to.be.revertedWith(
        "Deposit: Wrong amount"
      );

      await expect(privateSale.connect(firstTierUser1).deposit({ value: allocationCostThirdTier })).to.be.revertedWith(
        "Deposit: Wrong amount"
      );

      // 2. User cannot deposit twice
      await privateSale.connect(secondTierUser1).deposit({ value: allocationCostSecondTier });
      await expect(privateSale.connect(secondTierUser1).deposit({ value: allocationCostThirdTier })).to.be.revertedWith(
        "Deposit: Has deposited"
      );

      // 3. User cannot deposit if not whitelisted
      await expect(privateSale.connect(randomUser).deposit({ value: allocationCostThirdTier })).to.be.revertedWith(
        "Deposit: Not whitelisted"
      );

      // 4. User cannot harvest/withdraw if wrong phase
      await expect(privateSale.connect(secondTierUser1).harvest()).to.be.revertedWith("Harvest: Phase must be Staking");
      await expect(privateSale.connect(secondTierUser1).withdraw()).to.be.revertedWith(
        "Withdraw: Phase must be Withdraw"
      );

      // 5. Admin cannot change the whitelist
      await expect(privateSale.connect(admin).whitelistUsers([randomUser.address], "1")).to.be.revertedWith(
        "Owner: Phase must be Pending"
      );

      await expect(privateSale.connect(admin).removeUserFromWhitelist(firstTierUser4.address)).to.be.revertedWith(
        "Owner: Phase must be Pending"
      );

      // 6. Admin cannot change exchange rate, allocation cost, exchange rate, block for withdrawal
      await expect(privateSale.connect(admin).setAllocationCostPerTier("0", "100")).to.be.revertedWith(
        "Owner: Phase must be Pending"
      );

      await expect(
        privateSale.connect(admin).setBlockForWithdrawal(maxBlockForWithdrawal.add(BigNumber.from("1")))
      ).to.be.revertedWith("Owner: Block for withdrawal must be lower than max block for withdrawal");

      await expect(privateSale.connect(admin).setPriceOfETHInLOOKS("100")).to.be.revertedWith(
        "Owner: Phase must be Pending"
      );

      // 7. Admin cannot withdraw
      await expect(privateSale.connect(admin).withdrawCommittedAmount()).to.be.revertedWith(
        "Owner: Phase must be Over"
      );

      // 8. User/admin cannot update sale phase to withdraw
      await expect(privateSale.connect(admin).updateSalePhaseToWithdraw()).to.be.revertedWith("Phase: Must be Staking");
    });

    it("Over phase / Risk checks work as expected // LOOKS return as expected if some users didn't participate", async () => {
      // Set up for phase 1
      blockForWithdrawal = BigNumber.from(await ethers.provider.getBlockNumber()).add("1000");
      await privateSale.connect(admin).setBlockForWithdrawal(blockForWithdrawal);

      await privateSale.connect(admin).whitelistUsers(firstTierUserAddresses, "1");
      await privateSale.connect(admin).whitelistUsers(secondTierUserAddresses, "2");
      await privateSale.connect(admin).whitelistUsers(thirdTierUserAddresses, "3");

      await looksRareToken.connect(admin).transfer(privateSale.address, totalLooksDistributed);
      await privateSale.connect(admin).updateSalePhase("1");

      for (const user of firstTierUsers) {
        await privateSale.connect(user).deposit({ value: allocationCostFirstTier });
      }

      for (const user of secondTierUsers) {
        await privateSale.connect(user).deposit({ value: allocationCostSecondTier });
      }

      // We remove one of the third-tier users
      const newThirdTierUsers = thirdTierUsers;
      newThirdTierUsers.pop();

      for (const user of newThirdTierUsers) {
        await privateSale.connect(user).deposit({ value: allocationCostThirdTier });
      }

      // 2. Owner updates sale status to withdrawal (pre-staking)
      await privateSale.connect(admin).updateSalePhase("2");

      // 3. Owner withdraws ethers (it also updates sale status to staking)
      const tx = await privateSale.connect(admin).withdrawCommittedAmount();
      await expect(tx).to.emit(privateSale, "NewSalePhase").withArgs(BigNumber.from("3"));

      const amountLOOKSForTier3 = (await privateSale.priceOfETHInLOOKS()).mul(
        await privateSale.allocationCostPerTier("3")
      );

      // There is a LOOKS surplus transferred to the admin
      await expect(tx)
        .to.emit(looksRareToken, "Transfer")
        .withArgs(privateSale.address, admin.address, amountLOOKSForTier3);

      // Cannot update phase to deposit
      await expect(privateSale.connect(admin).updateSalePhase("1")).to.be.revertedWith("Owner: Phase must be Pending");

      // Admin deposits 10 WETH
      const firstDepositAmount = parseEther("10");
      await weth.connect(admin).transfer(privateSale.address, firstDepositAmount);

      // 1. Cannot harvest if user didn't participate or didn't put money (but was whitelisted)
      assert.deepEqual(await privateSale.calculatePendingRewards(randomUser.address), constants.Zero);
      await expect(privateSale.connect(randomUser).harvest()).to.be.revertedWith("Harvest: User not eligible");
      await expect(privateSale.connect(thirdTierUser5).harvest()).to.be.revertedWith("Harvest: User not eligible");

      // 2. Too early to withdraw
      await advanceBlockTo(blockForWithdrawal.sub(BigNumber.from("2")));

      await expect(privateSale.connect(firstTierUser1).updateSalePhaseToWithdraw()).to.be.revertedWith(
        "Phase: Too early to update sale status"
      );

      // Time travel to blockForWithdrawl
      await advanceBlockTo(blockForWithdrawal);
      await privateSale.connect(firstTierUser1).updateSalePhaseToWithdraw();

      // 3. Cannot withdraw if user didn't participate or didn't put money (but was whitelisted)
      await expect(privateSale.connect(randomUser).withdraw()).to.be.revertedWith("Withdraw: User not eligible");
      await expect(privateSale.connect(thirdTierUser5).withdraw()).to.be.revertedWith("Withdraw: User not eligible");

      // 4. User cannot withdraw twice or harvest after withdrawing
      await privateSale.connect(firstTierUser1).withdraw();
      await expect(privateSale.connect(firstTierUser1).withdraw()).to.be.revertedWith(
        "Withdraw: Has already withdrawn"
      );
      await expect(privateSale.connect(firstTierUser1).harvest()).to.be.revertedWith("Harvest: Phase must be Staking");
    });
  });

  describe("#3 - Owner functions", async () => {
    it("Ownable functions are only callable by owner", async () => {
      await expect(privateSale.connect(randomUser).whitelistUsers([randomUser.address], "1")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(privateSale.connect(randomUser).removeUserFromWhitelist(firstTierUser4.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      // 6. Admin cannot change exchange rate, allocation cost, exchange rate, block for withdrawal
      await expect(privateSale.connect(randomUser).setAllocationCostPerTier("0", "100")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(privateSale.connect(randomUser).updateSalePhase("0")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(privateSale.connect(randomUser).withdrawCommittedAmount()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(privateSale.connect(randomUser).setBlockForWithdrawal("100")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(privateSale.connect(randomUser).setPriceOfETHInLOOKS("100")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});
