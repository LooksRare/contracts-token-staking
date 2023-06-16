import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { increaseTo } from "./helpers/block-traveller";
import { computeDoubleHash, createDoubleHashMerkleTree } from "./helpers/cryptography";

const { parseEther } = utils;

describe("SeasonRewardsDistributor", () => {
  let mockLooksRareToken: Contract;
  let seasonRewardsDistributor: Contract;

  let admin: SignerWithAddress;
  let accounts: SignerWithAddress[];

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    admin = accounts[0];

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockLooksRareToken = await MockERC20.deploy("LooksRare Token", "LOOKS");
    await mockLooksRareToken.deployed();
    await mockLooksRareToken.connect(admin).mint(admin.address, parseEther("1000000").toString());

    const SeasonRewardsDistributor = await ethers.getContractFactory("SeasonRewardsDistributor");
    seasonRewardsDistributor = await SeasonRewardsDistributor.deploy(mockLooksRareToken.address, admin.address);
    await seasonRewardsDistributor.deployed();

    // Transfer funds to the mockLooksRareToken
    await mockLooksRareToken.connect(admin).transfer(seasonRewardsDistributor.address, parseEther("10000"));
  });

  describe("#1 - Regular claims work as expected", async () => {
    it("Claim - Users can claim", async () => {
      // Users 1 to 4
      const json = {
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
      };

      let [tree, hexRoot] = createDoubleHashMerkleTree(json);

      let tx = await seasonRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("5000"));
      await expect(tx).to.emit(seasonRewardsDistributor, "UpdateTradingRewards").withArgs("1");

      // All users except the 4th one claims
      for (const [index, [user, value]] of Object.entries(Object.entries(json))) {
        const signedUser = accounts[Number(index) + 1];

        if (signedUser === accounts[3]) {
          break;
        }
        // Compute the proof for the user
        const hexProof = tree.getHexProof(computeDoubleHash(user, value), Number(index));

        // Verify leaf is matched in the tree with the computed root
        assert.isTrue(tree.verify(hexProof, computeDoubleHash(user, value), hexRoot));

        // Check user status
        let claimStatus = await seasonRewardsDistributor.canClaim(user, value, hexProof);
        assert.isTrue(claimStatus[0]);
        assert.equal(claimStatus[1].toString(), value);

        tx = await seasonRewardsDistributor.connect(signedUser).claim(value, hexProof);
        await expect(tx).to.emit(seasonRewardsDistributor, "RewardsClaim").withArgs(user, "1", value);

        claimStatus = await seasonRewardsDistributor.canClaim(user, value, hexProof);
        assert.isFalse(claimStatus[0]);
        assert.deepEqual(claimStatus[1], constants.Zero);

        assert.equal((await seasonRewardsDistributor.amountClaimedByUser(user)).toString(), value);

        // Cannot double claim
        await expect(seasonRewardsDistributor.connect(signedUser).claim(value, hexProof)).to.be.revertedWith(
          "AlreadyClaimed()"
        );
      }

      // Transfer funds to the mockLooksRareToken
      await mockLooksRareToken.connect(admin).transfer(seasonRewardsDistributor.address, parseEther("10000"));

      // Users 1 to 4 (10k rewards added)
      const jsonRound2 = {
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("8000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("6000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("3000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("3000").toString(),
      };

      [tree, hexRoot] = createDoubleHashMerkleTree(jsonRound2);

      tx = await seasonRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("8000"));
      await expect(tx).to.emit(seasonRewardsDistributor, "UpdateTradingRewards").withArgs("2");

      // All users except the 4th one claims
      for (const [index, [user, value]] of Object.entries(Object.entries(jsonRound2))) {
        const signedUser = accounts[Number(index) + 1];

        if (user === accounts[3].address) {
          break;
        }

        // Compute the proof for the user
        const hexProof = tree.getHexProof(computeDoubleHash(user, value), Number(index));

        // Verify leaf is matched in the tree with the computed root
        assert.isTrue(tree.verify(hexProof, computeDoubleHash(user, value), hexRoot));

        // Fetch the amount previous claimed by the user and deduct the amount they will receive
        const amountPreviouslyClaimed = await seasonRewardsDistributor.amountClaimedByUser(user);
        const expectedAmountToReceive = BigNumber.from(value).sub(BigNumber.from(amountPreviouslyClaimed.toString()));

        // Check user status
        let claimStatus = await seasonRewardsDistributor.canClaim(user, value, hexProof);
        assert.isTrue(claimStatus[0]);
        assert.deepEqual(claimStatus[1], expectedAmountToReceive);

        tx = await seasonRewardsDistributor.connect(signedUser).claim(value, hexProof);
        await expect(tx).to.emit(seasonRewardsDistributor, "RewardsClaim").withArgs(user, "2", expectedAmountToReceive);

        claimStatus = await seasonRewardsDistributor.canClaim(user, value, hexProof);
        assert.isFalse(claimStatus[0]);
        assert.deepEqual(claimStatus[1], constants.Zero);

        assert.equal((await seasonRewardsDistributor.amountClaimedByUser(user)).toString(), value);

        // Cannot double claim
        await expect(seasonRewardsDistributor.connect(signedUser).claim(value, hexProof)).to.be.revertedWith(
          "AlreadyClaimed()"
        );
      }

      // User (accounts[3]) claims for two periods
      const lateClaimer = accounts[3];
      const expectedAmountToReceive = parseEther("3000");

      // Compute the proof for the user4
      const hexProof = tree.getHexProof(computeDoubleHash(lateClaimer.address, expectedAmountToReceive.toString()), 2);

      // Verify leaf is matched in the tree with the computed root

      assert.isTrue(
        tree.verify(hexProof, computeDoubleHash(lateClaimer.address, expectedAmountToReceive.toString()), hexRoot)
      );

      tx = await seasonRewardsDistributor.connect(lateClaimer).claim(expectedAmountToReceive, hexProof);
      await expect(tx)
        .to.emit(seasonRewardsDistributor, "RewardsClaim")
        .withArgs(lateClaimer.address, "2", expectedAmountToReceive);
    });

    it("Claim - Users cannot claim with wrong proofs", async () => {
      // Users 1 to 4
      const json = {
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
      };

      // Compute tree
      const [tree, hexRoot] = createDoubleHashMerkleTree(json);

      const user1 = accounts[1];
      const user2 = accounts[2];
      const notEligibleUser = accounts[10];

      const expectedAmountToReceiveForUser1 = parseEther("5000");
      const expectedAmountToReceiveForUser2 = parseEther("3000");

      // Compute the proof for user1/user2
      const hexProof1 = tree.getHexProof(
        computeDoubleHash(user1.address, expectedAmountToReceiveForUser1.toString()),
        0
      );
      const hexProof2 = tree.getHexProof(
        computeDoubleHash(user2.address, expectedAmountToReceiveForUser2.toString()),
        1
      );

      // Owner adds trading rewards and unpause distribution
      await seasonRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("5000"));

      // 1. Verify leafs for user1/user2 are matched in the tree with the computed root
      assert.isTrue(
        tree.verify(hexProof1, computeDoubleHash(user1.address, expectedAmountToReceiveForUser1.toString()), hexRoot)
      );

      assert.isTrue(
        tree.verify(hexProof2, computeDoubleHash(user2.address, expectedAmountToReceiveForUser2.toString()), hexRoot)
      );

      // 2. User2 cannot claim with proof of user1
      assert.isFalse(
        tree.verify(hexProof1, computeDoubleHash(user2.address, expectedAmountToReceiveForUser1.toString()), hexRoot)
      );

      assert.isFalse(
        (await seasonRewardsDistributor.canClaim(user2.address, expectedAmountToReceiveForUser2, hexProof1))[0]
      );

      await expect(
        seasonRewardsDistributor.connect(user2).claim(expectedAmountToReceiveForUser2, hexProof1)
      ).to.be.revertedWith("InvalidProof()");

      // 3. User1 cannot claim with proof of user2
      assert.isFalse(
        tree.verify(hexProof2, computeDoubleHash(user1.address, expectedAmountToReceiveForUser2.toString()), hexRoot)
      );

      assert.isFalse(
        (await seasonRewardsDistributor.canClaim(user1.address, expectedAmountToReceiveForUser2, hexProof2))[0]
      );

      await expect(
        seasonRewardsDistributor.connect(user1).claim(expectedAmountToReceiveForUser1, hexProof2)
      ).to.be.revertedWith("InvalidProof()");

      // 4. User1 cannot claim with amount of user2
      assert.isFalse(
        tree.verify(hexProof1, computeDoubleHash(user1.address, expectedAmountToReceiveForUser2.toString()), hexRoot)
      );

      assert.isFalse(
        (await seasonRewardsDistributor.canClaim(user1.address, expectedAmountToReceiveForUser2, hexProof1))[0]
      );

      await expect(
        seasonRewardsDistributor.connect(user1).claim(expectedAmountToReceiveForUser2, hexProof1)
      ).to.be.revertedWith("InvalidProof()");

      // 5. User2 cannot claim with amount of user1
      assert.isFalse(
        tree.verify(hexProof2, computeDoubleHash(user2.address, expectedAmountToReceiveForUser1.toString()), hexRoot)
      );

      assert.isFalse(
        (await seasonRewardsDistributor.canClaim(user2.address, expectedAmountToReceiveForUser1, hexProof2))[0]
      );

      await expect(
        seasonRewardsDistributor.connect(user2).claim(expectedAmountToReceiveForUser1, hexProof2)
      ).to.be.revertedWith("InvalidProof()");

      // 6. Non-eligible user cannot claim with proof/amount of user1
      assert.isFalse(
        tree.verify(
          hexProof1,
          computeDoubleHash(notEligibleUser.address, expectedAmountToReceiveForUser1.toString()),
          hexRoot
        )
      );

      assert.isFalse(
        (
          await seasonRewardsDistributor.canClaim(notEligibleUser.address, expectedAmountToReceiveForUser1, hexProof1)
        )[0]
      );

      await expect(
        seasonRewardsDistributor.connect(notEligibleUser).claim(expectedAmountToReceiveForUser1, hexProof1)
      ).to.be.revertedWith("InvalidProof()");

      // 7. Non-eligible user cannot claim with proof/amount of user1
      assert.isFalse(
        tree.verify(
          hexProof2,
          computeDoubleHash(notEligibleUser.address, expectedAmountToReceiveForUser2.toString()),
          hexRoot
        )
      );

      assert.isFalse(
        (
          await seasonRewardsDistributor.canClaim(notEligibleUser.address, expectedAmountToReceiveForUser2, hexProof2)
        )[0]
      );

      await expect(
        seasonRewardsDistributor.connect(notEligibleUser).claim(expectedAmountToReceiveForUser2, hexProof2)
      ).to.be.revertedWith("InvalidProof()");
    });

    it("Claim - User cannot claim if error in tree computation due to amount too high", async () => {
      // Users 1 to 4
      const json = {
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
      };

      // Compute tree
      const [tree, hexRoot] = createDoubleHashMerkleTree(json);

      const user1 = accounts[1];
      const expectedAmountToReceiveForUser1 = parseEther("5000");

      // Compute the proof for user1/user2
      const hexProof1 = tree.getHexProof(
        computeDoubleHash(user1.address, expectedAmountToReceiveForUser1.toString()),
        0
      );

      // Owner adds trading rewards and unpause distribution
      await seasonRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("4999.9999"));

      await expect(
        seasonRewardsDistributor.connect(user1).claim(expectedAmountToReceiveForUser1, hexProof1)
      ).to.be.revertedWith("AmountHigherThanMax()");
    });
  });

  describe("#2 - Owner functions", async () => {
    it("Owner - Owner cannot withdraw immediately after pausing", async () => {
      const depositAmount = parseEther("10000");

      // Transfer funds to the mockLooksRareToken
      await mockLooksRareToken.connect(admin).transfer(seasonRewardsDistributor.address, depositAmount);

      let tx = await seasonRewardsDistributor.connect(admin).pauseDistribution();
      await expect(tx).to.emit(seasonRewardsDistributor, "Paused");

      tx = await seasonRewardsDistributor.connect(admin).unpauseDistribution();
      await expect(tx).to.emit(seasonRewardsDistributor, "Unpaused");

      tx = await seasonRewardsDistributor.connect(admin).pauseDistribution();
      await expect(tx).to.emit(seasonRewardsDistributor, "Paused");

      await expect(seasonRewardsDistributor.connect(admin).withdrawTokenRewards(depositAmount)).to.be.revertedWith(
        "TooEarlyToWithdraw()"
      );

      const lastPausedTimestamp = await seasonRewardsDistributor.lastPausedTimestamp();
      const BUFFER_ADMIN_WITHDRAW = await seasonRewardsDistributor.BUFFER_ADMIN_WITHDRAW();

      // Jump in time to the period where it becomes possible to claim
      await increaseTo(lastPausedTimestamp.add(BUFFER_ADMIN_WITHDRAW).add(BigNumber.from("1")));

      tx = await seasonRewardsDistributor.connect(admin).withdrawTokenRewards(depositAmount);
      await expect(tx).to.emit(seasonRewardsDistributor, "TokenWithdrawnOwner").withArgs(depositAmount);
    });

    it("Owner - Owner cannot set twice the same Merkle Root", async () => {
      // Users 1 to 4
      const json = {
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
      };

      const [, hexRoot] = createDoubleHashMerkleTree(json);

      await seasonRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("5000"));

      await expect(
        seasonRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("5000"))
      ).to.be.revertedWith("MerkleRootAlreadyUsed()");
    });
  });
});
