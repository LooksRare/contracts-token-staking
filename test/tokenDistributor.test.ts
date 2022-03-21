import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { advanceBlockTo } from "./helpers/time";

const { parseEther } = utils;

describe("TokenDistributor", () => {
  let looksRareToken: Contract;
  let tokenDistributor: Contract;

  let admin: SignerWithAddress;
  let premintReceiver: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let tokenSplitter: SignerWithAddress;

  let startBlock: BigNumber;
  let premintAmount: BigNumber;
  let cap: BigNumber;

  beforeEach(async () => {
    [admin, user1, user2, user3, user4, tokenSplitter] =
      await ethers.getSigners();
    premintReceiver = admin;
    premintAmount = parseEther("2250");
    cap = parseEther("21000"); // 21,000 tokens

    const rewardsPerBlockForStaking = [
      parseEther("30"),
      parseEther("15"),
      parseEther("7.5"),
      parseEther("3.75"),
    ];
    const rewardsPerBlockForOthers = [
      parseEther("70"),
      parseEther("35"),
      parseEther("17.5"),
      parseEther("8.75"),
    ];
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

    startBlock = BigNumber.from(
      (await ethers.provider.getBlockNumber()).toString()
    ).add("100");

    const LooksRareToken = await ethers.getContractFactory("LooksRareToken");
    looksRareToken = await LooksRareToken.deploy(
      premintReceiver.address,
      premintAmount,
      cap
    );
    await looksRareToken.deployed();

    const TokenDistributor = await ethers.getContractFactory(
      "TokenDistributor"
    );
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

    await looksRareToken
      .connect(admin)
      .transferOwnership(tokenDistributor.address);

    // Each user receives 500 LOOKS tokens
    for (const user of [user1, user2, user3, user4]) {
      await looksRareToken
        .connect(admin)
        .transfer(user.address, parseEther("500"));
      await looksRareToken
        .connect(user)
        .approve(tokenDistributor.address, constants.MaxUint256);
      await tokenDistributor.connect(user).deposit(parseEther("100"));
    }
  });

  describe("#1 - Regular user/admin interactions", async () => {
    it("Scenario 1 - Block rewards change automatically with 4 halvings at a fixed frequency", async () => {
      await advanceBlockTo(startBlock.add("149"));

      // 100 * 30 / 4 + 49 * 15/4 = 750 + 183.75 = 933.75
      assert.deepEqual(
        await tokenDistributor.calculatePendingRewards(user1.address),
        parseEther("933.75")
      );

      // 100 * 30 / 4 + 50 * 15/4 = 750 + 187.5 = 937.5
      let tx = await tokenDistributor.connect(user1).withdrawAll();
      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(user1.address, parseEther("1037.5"), parseEther("937.5"));

      await expect(tx)
        .to.emit(tokenDistributor, "NewRewardsPerBlock")
        .withArgs(
          "1",
          startBlock.add("100"),
          parseEther("15"),
          parseEther("35")
        );

      // (100 * 70) + (50 * 35) = 8,750 tokens for token splitter (EOA for this test)
      assert.deepEqual(
        await looksRareToken.balanceOf(tokenSplitter.address),
        parseEther("8750")
      );

      await advanceBlockTo(startBlock.add("199"));

      // 937.5 + 49 * 15/3 = 1182.5
      assert.deepEqual(
        await tokenDistributor.calculatePendingRewards(user2.address),
        parseEther("1182.5")
      );

      // 937.5 + 50 * 15/3 = 1187.5
      tx = await tokenDistributor.connect(user2).withdraw(parseEther("50"));

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(user2.address, parseEther("50"), parseEther("1187.5"));

      // 1187.5 + 50 = 1237.5
      assert.deepEqual(
        (await tokenDistributor.userInfo(user2.address))[0],
        parseEther("1237.5")
      );

      // (100 * 70) + (100 * 35) = 10,500 tokens for token splitter (EOA for this test)
      assert.deepEqual(
        await looksRareToken.balanceOf(tokenSplitter.address),
        parseEther("10500")
      );

      await advanceBlockTo(startBlock.add("249"));

      // 1237.5 / (1237.5 + 200) * 50 * 7.5 = 322.826086956037500000
      tx = await tokenDistributor.connect(user2).harvestAndCompound();

      await expect(tx)
        .to.emit(tokenDistributor, "Compound")
        .withArgs(user2.address, parseEther("322.8260869560375"));

      await expect(tx)
        .to.emit(tokenDistributor, "NewRewardsPerBlock")
        .withArgs(
          "2",
          startBlock.add("200"),
          parseEther("7.5"),
          parseEther("17.5")
        );

      assert.deepEqual(
        (await tokenDistributor.userInfo(user2.address))[0],
        parseEther("1560.326086956037500000")
      );

      await advanceBlockTo(startBlock.add("500"));

      // 1560.3260869560375 / (1560.3260869560375 + 200) * (50 * 7.5 + 100 * 3.75) = 664.788514973218142844
      tx = await tokenDistributor.connect(user2).harvestAndCompound();

      await expect(tx)
        .to.emit(tokenDistributor, "Compound")
        .withArgs(user2.address, parseEther("664.788514973218142844"));

      await expect(tx)
        .to.emit(tokenDistributor, "NewRewardsPerBlock")
        .withArgs(
          "3",
          startBlock.add("300"),
          parseEther("3.75"),
          parseEther("8.75")
        );

      assert.deepEqual(
        await tokenDistributor.endBlock(),
        startBlock.add("400")
      );

      tx = await tokenDistributor.connect(user3).withdrawAll();

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(
          user3.address,
          parseEther("1356.1926990348"),
          parseEther("1256.1926990348")
        );

      tx = await tokenDistributor.connect(user4).withdrawAll();

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(
          user4.address,
          parseEther("1356.1926990348"),
          parseEther("1256.1926990348")
        );

      // 13,125 tokens for token splitter
      assert.deepEqual(
        await looksRareToken.balanceOf(tokenSplitter.address),
        parseEther("13125")
      );

      // Total supply matches the cap
      assert.deepEqual(await looksRareToken.totalSupply(), parseEther("21000"));
    });

    it("Scenario 2 - Block rewards change automatically with 4 adjustments at a non-fixed frequency", async () => {
      const LooksRareToken = await ethers.getContractFactory("LooksRareToken");

      looksRareToken = await LooksRareToken.deploy(
        premintReceiver.address,
        premintAmount,
        cap
      );
      await looksRareToken.deployed();

      // 120 * 25 + 30 * 50 + 7.5 * 100 + 3.75 * 100 = 5625 tokens to be distributed to stakers
      // 280 * 25 + 70 * 50 + 17.5 * 100 + 8.75 * 100 = 13,125 tokens to be distributed to fee splitter
      // Expected total supply at the end: 2250 + 5625 + 13,125 = 21,000 tokens

      const rewardsPerBlockForStaking = [
        parseEther("120"),
        parseEther("30"),
        parseEther("7.5"),
        parseEther("3.75"),
      ];
      const rewardsPerBlockForOthers = [
        parseEther("280"),
        parseEther("70"),
        parseEther("17.5"),
        parseEther("8.75"),
      ];
      const periodLengthesInBlocks = [
        BigNumber.from("25"),
        BigNumber.from("50"),
        BigNumber.from("100"),
        BigNumber.from("100"),
      ];

      const numberPeriods = "4";

      const TokenDistributor = await ethers.getContractFactory(
        "TokenDistributor"
      );

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

      await looksRareToken
        .connect(admin)
        .transferOwnership(tokenDistributor.address);

      // Each user receives 500 LOOKS tokens
      for (const user of [user1, user2, user3, user4]) {
        await looksRareToken
          .connect(admin)
          .transfer(user.address, parseEther("500"));
        await looksRareToken
          .connect(user)
          .approve(tokenDistributor.address, constants.MaxUint256);

        const tx = await tokenDistributor
          .connect(user)
          .deposit(parseEther("100"));

        await expect(tx)
          .to.emit(tokenDistributor, "Deposit")
          .withArgs(user.address, parseEther("100"), parseEther("0"));
      }

      // Advance to half of the second period
      await advanceBlockTo(startBlock.add("49"));

      // 120 * 25 / 4 + 24 * 30/4 = 930
      assert.deepEqual(
        await tokenDistributor.calculatePendingRewards(user1.address),
        parseEther("930")
      );

      // 120 * 25 / 4 + 25 * 30/4 = 937.5
      let tx = await tokenDistributor.connect(user1).withdrawAll();

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(user1.address, parseEther("1037.5"), parseEther("937.5"));

      // (25 * 280) + (25 * 70) = 8,750 tokens for token splitter (EOA for this test)
      assert.deepEqual(
        await looksRareToken.balanceOf(tokenSplitter.address),
        parseEther("8750")
      );

      // Time travel to go through 2 periods
      await advanceBlockTo(startBlock.add("199"));

      // 937.5 + 25 * 30/3 + 100 * 7.5/3 + 24 * 3.75/3 = 1467.5
      assert.deepEqual(
        await tokenDistributor.calculatePendingRewards(user2.address),

        parseEther("1467.5")
      );

      // 937.5 + 25 * 30/3 + 100 * 7.5/3 + 25 * 3.75/3 = 1468.75
      tx = await tokenDistributor.connect(user2).withdraw(parseEther("50"));

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(user2.address, parseEther("50"), parseEther("1468.75"));

      // 1468.75 + 50 = 1518.75
      assert.deepEqual(
        (await tokenDistributor.userInfo(user2.address))[0],
        parseEther("1518.75")
      );

      // 280 * 25 + 70 * 50 + 17.5 * 100 + 8.75 * 25 = 12,468.75 tokens for token splitter (EOA for this test)
      assert.deepEqual(
        await looksRareToken.balanceOf(tokenSplitter.address),
        parseEther("12468.75")
      );

      // Advance to end of pool
      await advanceBlockTo(startBlock.add("500"));

      // 1518.75 / (1518.75 + 200) * 75 * 3.75 = 248.522727272175
      tx = await tokenDistributor.connect(user2).harvestAndCompound();

      await expect(tx)
        .to.emit(tokenDistributor, "Compound")
        .withArgs(user2.address, parseEther("248.522727272175"));

      // Equal to the sum of the compounded amount + previously harvestedAmount + half of the original deposit (50)
      assert.deepEqual(
        (await tokenDistributor.userInfo(user2.address))[0],
        parseEther("1767.272727272175")
      );

      // 275 blocks for the total reward schedule
      assert.deepEqual(
        await tokenDistributor.endBlock(),
        startBlock.add("275")
      );

      tx = await tokenDistributor.connect(user2).withdrawAll();

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(
          user2.address,
          parseEther("1767.272727272175"),
          parseEther("0")
        );

      tx = await tokenDistributor.connect(user3).withdrawAll();

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(
          user3.address,
          parseEther("1585.1136363636"),
          parseEther("1485.1136363636")
        );

      tx = await tokenDistributor.connect(user4).withdrawAll();

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(
          user4.address,
          parseEther("1585.1136363636"),
          parseEther("1485.1136363636")
        );

      // 13,125 tokens for token splitter
      assert.deepEqual(
        await looksRareToken.balanceOf(tokenSplitter.address),
        parseEther("13125")
      );

      // Total supply is minted
      assert.deepEqual(await looksRareToken.totalSupply(), parseEther("21000"));
    });

    it("User can unstake after 10 blocks", async () => {
      await advanceBlockTo(startBlock.add("9"));

      // (9 * 30 / 4) = 67.5 tokens pending
      assert.deepEqual(
        await tokenDistributor.calculatePendingRewards(user1.address),
        parseEther("67.5")
      );

      // (10 * 30) / 4 = 75 tokens pending (the new tx moves by 1 block)
      const tx = await tokenDistributor.connect(user1).withdrawAll();

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(user1.address, parseEther("175"), parseEther("75"));

      // 10 * 70 = 700 tokens for token splitter (EOA for this test)
      assert.deepEqual(
        await looksRareToken.balanceOf(tokenSplitter.address),
        parseEther("700")
      );
    });

    it("User can compound after 10 blocks", async () => {
      await advanceBlockTo(startBlock.add("9"));

      // (9 * 30 / 4) = 67.5 tokens pending
      assert.deepEqual(
        await tokenDistributor.calculatePendingRewards(user1.address),
        parseEther("67.5")
      );

      // (10 * 30) / 4 = 75 tokens pending (the new tx moves by 1 block)
      const tx = await tokenDistributor.connect(user1).harvestAndCompound();

      await expect(tx)
        .to.emit(tokenDistributor, "Compound")
        .withArgs(user1.address, parseEther("75"));

      // 10 * 70 = 700 tokens for token splitter (EOA for this test)
      assert.deepEqual(
        await looksRareToken.balanceOf(tokenSplitter.address),
        parseEther("700")
      );
    });

    it("Anyone can call updatePool", async () => {
      await advanceBlockTo(startBlock.add("9"));

      let tx = await tokenDistributor.connect(user1).updatePool();

      // 30 * 10 blocks = 300
      await expect(tx)
        .to.emit(looksRareToken, "Transfer")
        .withArgs(
          constants.AddressZero,
          tokenDistributor.address,
          parseEther("300")
        );

      // 30 * 1 block = 30
      tx = await tokenDistributor.connect(admin).updatePool();

      await expect(tx)
        .to.emit(looksRareToken, "Transfer")
        .withArgs(
          constants.AddressZero,
          tokenDistributor.address,
          parseEther("30")
        );
    });

    it("User can withdraw before start, deposit after start", async () => {
      assert.deepEqual(
        await tokenDistributor.calculatePendingRewards(user1.address),
        constants.Zero
      );

      for (const user of [user1, user2, user3]) {
        const tx = await tokenDistributor
          .connect(user)
          .withdraw(parseEther("100"));

        await expect(tx)
          .to.emit(tokenDistributor, "Withdraw")
          .withArgs(user.address, parseEther("100"), parseEther("0"));
      }
      let tx = await tokenDistributor.connect(user4).withdrawAll();

      await expect(tx)
        .to.emit(tokenDistributor, "Withdraw")
        .withArgs(user4.address, parseEther("100"), parseEther("0"));

      await advanceBlockTo(startBlock);

      tx = await tokenDistributor.connect(user1).deposit(parseEther("100"));

      await expect(tx)
        .to.emit(tokenDistributor, "Deposit")
        .withArgs(user1.address, parseEther("100"), parseEther("0"));
    });

    it("User can deposit twice before start and harvest remains 0", async () => {
      const tx = await tokenDistributor
        .connect(user1)
        .deposit(parseEther("100"));

      await expect(tx)
        .to.emit(tokenDistributor, "Deposit")
        .withArgs(user1.address, parseEther("100"), parseEther("0"));
    });
  });

  describe("#2 - Revertions", async () => {
    it("Cannot set with wrong parameters", async () => {
      let rewardsPerBlockForStaking = [
        parseEther("30"),
        parseEther("15"),
        parseEther("7.5"),
        parseEther("3.75"),
      ];
      let rewardsPerBlockForOthers = [
        parseEther("70"),
        parseEther("35"),
        parseEther("17.5"),
        parseEther("8.75"),
      ];
      let periodLengthesInBlocks = [
        BigNumber.from("100"),
        BigNumber.from("100"),
        BigNumber.from("100"),
      ];

      const numberPeriods = "4";

      // 30 * 100 + 15 * 100 + 7.5 * 100 + 3.75 * 100 = 5625 tokens to be distributed to stakers
      // 70 * 100 + 35 * 100 + 17.5 * 100 + 8.75 * 100 = 13,125 tokens to be distributed to fee splitter
      // Expected total supply at the end: 2250 + 5625 + 13,125 = 21,000 tokens

      startBlock = BigNumber.from(
        (await ethers.provider.getBlockNumber()).toString()
      ).add("100");

      periodLengthesInBlocks = [
        BigNumber.from("100"),
        BigNumber.from("100"),
        BigNumber.from("100"),
      ];

      const TokenDistributor = await ethers.getContractFactory(
        "TokenDistributor"
      );

      await expect(
        TokenDistributor.deploy(
          looksRareToken.address,
          tokenSplitter.address,
          startBlock,
          rewardsPerBlockForStaking,
          rewardsPerBlockForOthers,
          periodLengthesInBlocks,
          numberPeriods
        )
      ).to.be.revertedWith("Distributor: Lengthes must match numberPeriods");

      // Reset
      periodLengthesInBlocks = [
        BigNumber.from("100"),
        BigNumber.from("100"),
        BigNumber.from("100"),
      ];

      // Drop one of the items
      rewardsPerBlockForStaking = [
        parseEther("15"),
        parseEther("7.5"),
        parseEther("3.75"),
      ];

      await expect(
        TokenDistributor.deploy(
          looksRareToken.address,
          tokenSplitter.address,
          startBlock,
          rewardsPerBlockForStaking,
          rewardsPerBlockForOthers,
          periodLengthesInBlocks,
          numberPeriods
        )
      ).to.be.revertedWith("Distributor: Lengthes must match numberPeriods");

      // Reset
      rewardsPerBlockForStaking = [
        parseEther("30"),
        parseEther("15"),
        parseEther("7.5"),
        parseEther("3.75"),
      ];

      // Drop one of the items
      rewardsPerBlockForOthers = [
        parseEther("35"),
        parseEther("17.5"),
        parseEther("8.75"),
      ];

      await expect(
        TokenDistributor.deploy(
          looksRareToken.address,
          tokenSplitter.address,
          startBlock,
          rewardsPerBlockForStaking,
          rewardsPerBlockForOthers,
          periodLengthesInBlocks,
          numberPeriods
        )
      ).to.be.revertedWith("Distributor: Lengthes must match numberPeriods");

      await expect(
        TokenDistributor.deploy(
          looksRareToken.address,
          tokenSplitter.address,
          startBlock,
          rewardsPerBlockForStaking,
          rewardsPerBlockForOthers,
          periodLengthesInBlocks,
          numberPeriods
        )
      ).to.be.revertedWith("Distributor: Lengthes must match numberPeriods");

      // Reset
      rewardsPerBlockForOthers = [
        parseEther("70"),
        parseEther("35"),
        parseEther("17.5"),
        parseEther("8.75"),
      ];

      // Make a mistake in allocation
      periodLengthesInBlocks = [
        BigNumber.from("90"),
        BigNumber.from("100"),
        BigNumber.from("100"),
        BigNumber.from("100"),
      ];

      await expect(
        TokenDistributor.deploy(
          looksRareToken.address,
          tokenSplitter.address,
          startBlock,
          rewardsPerBlockForStaking,
          rewardsPerBlockForOthers,
          periodLengthesInBlocks,
          numberPeriods
        )
      ).to.be.revertedWith("Distributor: Wrong reward parameters");

      // Make a mistake in allocation
      periodLengthesInBlocks = [
        BigNumber.from("50"),
        BigNumber.from("100"),
        BigNumber.from("100"),
        BigNumber.from("100"),
      ];
      // Increases rewardsPerBlockForStaking by 2 for first period while reducing length by 2 but forgets to adjust other rewards
      rewardsPerBlockForStaking = [
        parseEther("60"),
        parseEther("15"),
        parseEther("7.5"),
        parseEther("3.75"),
      ];

      await expect(
        TokenDistributor.deploy(
          looksRareToken.address,
          tokenSplitter.address,
          startBlock,
          rewardsPerBlockForStaking,
          rewardsPerBlockForOthers,
          periodLengthesInBlocks,
          numberPeriods
        )
      ).to.be.revertedWith("Distributor: Wrong reward parameters");
    });

    it("Cannot deposit if amount is 0", async () => {
      await expect(
        tokenDistributor.connect(user1).deposit("0")
      ).to.be.revertedWith("Deposit: Amount must be > 0");
    });

    it("Cannot compound if pending reward is 0", async () => {
      const tx = await tokenDistributor.connect(user1).harvestAndCompound();

      // Since it doesn't revert, verify that the Compound event is not emitted
      await expect(tx).to.not.emit(tokenDistributor, "Compound");
    });

    it("Cannot withdraw if amount is 0 or larger than user balance", async () => {
      await expect(
        tokenDistributor.connect(user1).withdraw("0")
      ).to.be.revertedWith(
        "Withdraw: Amount must be > 0 or lower than user balance"
      );

      await expect(
        tokenDistributor.connect(user1).withdraw(parseEther("100.0000001"))
      ).to.be.revertedWith(
        "Withdraw: Amount must be > 0 or lower than user balance"
      );

      await expect(
        tokenDistributor.connect(user1).withdraw("0")
      ).to.be.revertedWith(
        "Withdraw: Amount must be > 0 or lower than user balance"
      );
    });
  });
});
