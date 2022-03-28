import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MerkleTree } from "merkletreejs";

/* eslint-disable node/no-extraneous-import */
import { keccak256 } from "js-sha3";
import { increaseTo } from "./helpers/block-traveller";

const { parseEther } = utils;

function computeHash(user: string, amount: string) {
  return Buffer.from(utils.solidityKeccak256(["address", "uint256"], [user, amount]).slice(2), "hex");
}

describe("TradingRewardsDistributor", () => {
  let mockLooksRareToken: Contract;
  let tradingRewardsDistributor: Contract;

  let admin: SignerWithAddress;
  let accounts: SignerWithAddress[];

  let tree: MerkleTree;
  let hexRoot: string;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    admin = accounts[0];

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockLooksRareToken = await MockERC20.deploy("LooksRare Token", "LOOKS");
    await mockLooksRareToken.deployed();
    await mockLooksRareToken.connect(admin).mint(admin.address, parseEther("1000000").toString());

    const TradingRewardsDistributor = await ethers.getContractFactory("TradingRewardsDistributor");
    tradingRewardsDistributor = await TradingRewardsDistributor.deploy(mockLooksRareToken.address);
    await tradingRewardsDistributor.deployed();

    // Transfer funds to the mockLooksRareToken
    await mockLooksRareToken.connect(admin).transfer(tradingRewardsDistributor.address, parseEther("10000"));
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

      tree = new MerkleTree(
        Object.entries(json).map((data) => computeHash(...data)),
        keccak256,
        { sortPairs: true }
      );

      // Compute the root of the tree
      hexRoot = tree.getHexRoot();

      let tx = await tradingRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("5000"));
      expect(tx).to.emit(tradingRewardsDistributor, "UpdateTradingRewards").withArgs("1");

      await tradingRewardsDistributor.connect(admin).unpauseDistribution();

      // All users except the 4th one claims
      for (const [index, [user, value]] of Object.entries(Object.entries(json))) {
        const signedUser = accounts[Number(index) + 1];

        if (signedUser === accounts[3]) {
          break;
        }
        // Compute the proof for the user
        const hexProof = tree.getHexProof(computeHash(user, value), Number(index));

        // Verify leaf is matched in the tree with the computed root
        assert.isTrue(tree.verify(hexProof, computeHash(user, value), hexRoot));

        // Check user status
        let claimStatus = await tradingRewardsDistributor.canClaim(user, value, hexProof);
        assert.isTrue(claimStatus[0]);
        assert.equal(claimStatus[1].toString(), value);

        tx = await tradingRewardsDistributor.connect(signedUser).claim(value, hexProof);
        expect(tx).to.emit(tradingRewardsDistributor, "RewardsClaim").withArgs(user, "1", value);

        claimStatus = await tradingRewardsDistributor.canClaim(user, value, hexProof);
        assert.isFalse(claimStatus[0]);
        assert.deepEqual(claimStatus[1], constants.Zero);

        assert.equal((await tradingRewardsDistributor.amountClaimedByUser(user)).toString(), value);

        // Cannot double claim
        await expect(tradingRewardsDistributor.connect(signedUser).claim(value, hexProof)).to.be.revertedWith(
          "Rewards: Already claimed"
        );
      }

      // Transfer funds to the mockLooksRareToken
      await mockLooksRareToken.connect(admin).transfer(tradingRewardsDistributor.address, parseEther("10000"));

      // Users 1 to 4 (10k rewards added)
      const jsonRound2 = {
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("8000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("6000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("3000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("3000").toString(),
      };

      tree = new MerkleTree(
        Object.entries(jsonRound2).map((data) => computeHash(...data)),
        keccak256,
        { sortPairs: true }
      );

      // Compute the root of the tree
      hexRoot = tree.getHexRoot();

      tx = await tradingRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("8000"));
      expect(tx).to.emit(tradingRewardsDistributor, "UpdateTradingRewards").withArgs("2");

      // All users except the 4th one claims
      for (const [index, [user, value]] of Object.entries(Object.entries(jsonRound2))) {
        const signedUser = accounts[Number(index) + 1];

        if (user === accounts[3].address) {
          break;
        }

        // Compute the proof for the user
        const hexProof = tree.getHexProof(computeHash(user, value), Number(index));

        // Verify leaf is matched in the tree with the computed root
        assert.isTrue(tree.verify(hexProof, computeHash(user, value), hexRoot));

        // Fetch the amount previous claimed by the user and deduct the amount they will receive
        const amountPreviouslyClaimed = await tradingRewardsDistributor.amountClaimedByUser(user);
        const expectedAmountToReceive = BigNumber.from(value).sub(BigNumber.from(amountPreviouslyClaimed.toString()));

        // Check user status
        let claimStatus = await tradingRewardsDistributor.canClaim(user, value, hexProof);
        assert.isTrue(claimStatus[0]);
        assert.deepEqual(claimStatus[1], expectedAmountToReceive);

        tx = await tradingRewardsDistributor.connect(signedUser).claim(value, hexProof);
        expect(tx).to.emit(tradingRewardsDistributor, "RewardsClaim").withArgs(user, "2", expectedAmountToReceive);

        claimStatus = await tradingRewardsDistributor.canClaim(user, value, hexProof);
        assert.isFalse(claimStatus[0]);
        assert.deepEqual(claimStatus[1], constants.Zero);

        assert.equal((await tradingRewardsDistributor.amountClaimedByUser(user)).toString(), value);

        // Cannot double claim
        await expect(tradingRewardsDistributor.connect(signedUser).claim(value, hexProof)).to.be.revertedWith(
          "Rewards: Already claimed"
        );
      }

      // User (accounts[3]) claims for two periods
      const lateClaimer = accounts[3];
      const expectedAmountToReceive = parseEther("3000");

      // Compute the proof for the user4
      const hexProof = tree.getHexProof(computeHash(lateClaimer.address, expectedAmountToReceive.toString()), 2);

      // Verify leaf is matched in the tree with the computed root

      assert.isTrue(
        tree.verify(hexProof, computeHash(lateClaimer.address, expectedAmountToReceive.toString()), hexRoot)
      );

      tx = await tradingRewardsDistributor.connect(lateClaimer).claim(expectedAmountToReceive, hexProof);
      expect(tx)
        .to.emit(tradingRewardsDistributor, "RewardsClaim")
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
      tree = new MerkleTree(
        Object.entries(json).map((data) => computeHash(...data)),
        keccak256,
        { sortPairs: true }
      );

      // Compute the root of the tree
      hexRoot = tree.getHexRoot();

      const user1 = accounts[1];
      const user2 = accounts[2];
      const notEligibleUser = accounts[10];

      const expectedAmountToReceiveForUser1 = parseEther("5000");
      const expectedAmountToReceiveForUser2 = parseEther("3000");

      // Compute the proof for user1/user2
      const hexProof1 = tree.getHexProof(computeHash(user1.address, expectedAmountToReceiveForUser1.toString()), 0);
      const hexProof2 = tree.getHexProof(computeHash(user2.address, expectedAmountToReceiveForUser2.toString()), 1);

      // Owner adds trading rewards and unpause distribution
      await tradingRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("5000"));
      await tradingRewardsDistributor.connect(admin).unpauseDistribution();

      // 1. Verify leafs for user1/user2 are matched in the tree with the computed root
      assert.isTrue(
        tree.verify(hexProof1, computeHash(user1.address, expectedAmountToReceiveForUser1.toString()), hexRoot)
      );

      assert.isTrue(
        tree.verify(hexProof2, computeHash(user2.address, expectedAmountToReceiveForUser2.toString()), hexRoot)
      );

      // 2. User2 cannot claim with proof of user1
      assert.isFalse(
        tree.verify(hexProof1, computeHash(user2.address, expectedAmountToReceiveForUser1.toString()), hexRoot)
      );

      assert.isFalse(
        (await tradingRewardsDistributor.canClaim(user2.address, expectedAmountToReceiveForUser2, hexProof1))[0]
      );

      await expect(
        tradingRewardsDistributor.connect(user2).claim(expectedAmountToReceiveForUser2, hexProof1)
      ).to.be.revertedWith("Rewards: Invalid proof");

      // 3. User1 cannot claim with proof of user2
      assert.isFalse(
        tree.verify(hexProof2, computeHash(user1.address, expectedAmountToReceiveForUser2.toString()), hexRoot)
      );

      assert.isFalse(
        (await tradingRewardsDistributor.canClaim(user1.address, expectedAmountToReceiveForUser2, hexProof2))[0]
      );

      await expect(
        tradingRewardsDistributor.connect(user1).claim(expectedAmountToReceiveForUser1, hexProof2)
      ).to.be.revertedWith("Rewards: Invalid proof");

      // 4. User1 cannot claim with amount of user2
      assert.isFalse(
        tree.verify(hexProof1, computeHash(user1.address, expectedAmountToReceiveForUser2.toString()), hexRoot)
      );

      assert.isFalse(
        (await tradingRewardsDistributor.canClaim(user1.address, expectedAmountToReceiveForUser2, hexProof1))[0]
      );

      await expect(
        tradingRewardsDistributor.connect(user1).claim(expectedAmountToReceiveForUser2, hexProof1)
      ).to.be.revertedWith("Rewards: Invalid proof");

      // 5. User2 cannot claim with amount of user1
      assert.isFalse(
        tree.verify(hexProof2, computeHash(user2.address, expectedAmountToReceiveForUser1.toString()), hexRoot)
      );

      assert.isFalse(
        (await tradingRewardsDistributor.canClaim(user2.address, expectedAmountToReceiveForUser1, hexProof2))[0]
      );

      await expect(
        tradingRewardsDistributor.connect(user2).claim(expectedAmountToReceiveForUser1, hexProof2)
      ).to.be.revertedWith("Rewards: Invalid proof");

      // 6. Non-eligible user cannot claim with proof/amount of user1
      assert.isFalse(
        tree.verify(
          hexProof1,
          computeHash(notEligibleUser.address, expectedAmountToReceiveForUser1.toString()),
          hexRoot
        )
      );

      assert.isFalse(
        (
          await tradingRewardsDistributor.canClaim(notEligibleUser.address, expectedAmountToReceiveForUser1, hexProof1)
        )[0]
      );

      await expect(
        tradingRewardsDistributor.connect(notEligibleUser).claim(expectedAmountToReceiveForUser1, hexProof1)
      ).to.be.revertedWith("Rewards: Invalid proof");

      // 7. Non-eligible user cannot claim with proof/amount of user1
      assert.isFalse(
        tree.verify(
          hexProof2,
          computeHash(notEligibleUser.address, expectedAmountToReceiveForUser2.toString()),
          hexRoot
        )
      );

      assert.isFalse(
        (
          await tradingRewardsDistributor.canClaim(notEligibleUser.address, expectedAmountToReceiveForUser2, hexProof2)
        )[0]
      );

      await expect(
        tradingRewardsDistributor.connect(notEligibleUser).claim(expectedAmountToReceiveForUser2, hexProof2)
      ).to.be.revertedWith("Rewards: Invalid proof");
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
      tree = new MerkleTree(
        Object.entries(json).map((data) => computeHash(...data)),
        keccak256,
        { sortPairs: true }
      );

      // Compute the root of the tree
      hexRoot = tree.getHexRoot();

      const user1 = accounts[1];
      const expectedAmountToReceiveForUser1 = parseEther("5000");

      // Compute the proof for user1/user2
      const hexProof1 = tree.getHexProof(computeHash(user1.address, expectedAmountToReceiveForUser1.toString()), 0);

      // Owner adds trading rewards and unpause distribution
      await tradingRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("4999.9999"));
      await tradingRewardsDistributor.connect(admin).unpauseDistribution();

      await expect(
        tradingRewardsDistributor.connect(user1).claim(expectedAmountToReceiveForUser1, hexProof1)
      ).to.be.revertedWith("Rewards: Amount higher than max");
    });
  });

  describe("#2 - Owner functions", async () => {
    it("Owner - Owner cannot withdraw immediately after pausing", async () => {
      const depositAmount = parseEther("10000");

      // Transfer funds to the mockLooksRareToken
      await mockLooksRareToken.connect(admin).transfer(tradingRewardsDistributor.address, depositAmount);

      let tx = await tradingRewardsDistributor.connect(admin).unpauseDistribution();
      expect(tx).to.emit(tradingRewardsDistributor, "Unpaused");

      tx = await tradingRewardsDistributor.connect(admin).pauseDistribution();
      expect(tx).to.emit(tradingRewardsDistributor, "Paused");

      await expect(tradingRewardsDistributor.connect(admin).withdrawTokenRewards(depositAmount)).to.be.revertedWith(
        "Owner: Too early to withdraw"
      );

      const lastPausedTimestamp = await tradingRewardsDistributor.lastPausedTimestamp();
      const BUFFER_ADMIN_WITHDRAW = await tradingRewardsDistributor.BUFFER_ADMIN_WITHDRAW();

      // Jump in time to the period where it becomes possible to claim
      await increaseTo(lastPausedTimestamp.add(BUFFER_ADMIN_WITHDRAW).add(BigNumber.from("1")));

      tx = await tradingRewardsDistributor.connect(admin).withdrawTokenRewards(depositAmount);
      expect(tx).to.emit(tradingRewardsDistributor, "TokenWithdrawnOwner").withArgs(depositAmount);
    });

    it("Owner - Owner cannot set twice the same Merkle Root", async () => {
      // Users 1 to 4
      const json = {
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
      };

      tree = new MerkleTree(
        Object.entries(json).map((data) => computeHash(...data)),
        keccak256,
        { sortPairs: true }
      );

      // Compute the root of the tree
      hexRoot = tree.getHexRoot();

      await tradingRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("5000"));
      await tradingRewardsDistributor.connect(admin).unpauseDistribution();

      await expect(
        tradingRewardsDistributor.connect(admin).updateTradingRewards(hexRoot, parseEther("5000"))
      ).to.be.revertedWith("Owner: Merkle root already used");
    });
  });
});
