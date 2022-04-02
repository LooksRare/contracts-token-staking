import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import MerkleTree from "merkletreejs";

import { increaseTo } from "./helpers/block-traveller";
import { computeHash, createMerkleTree } from "./helpers/cryptography";

const { parseEther } = utils;

describe("MultiRewardsDistributor", () => {
  let looksRareToken: Contract;
  let multiRewardsDistributor: Contract;

  let admin: SignerWithAddress;
  let accounts: SignerWithAddress[];

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const ONE_ADDRESS = "0x0000000000000000000000000000000000000001";

  // Safe Guard + Users 1 to 4
  const jsonTree0: Record<string, string> = {
    "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Safe Guard address
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
  };

  // Safe Guard (ONE_ADDRESS) + Users 1 to 3
  const jsonTree1: Record<string, string> = {
    "0x0000000000000000000000000000000000000001": parseEther("1").toString(), // Safe Guard address
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("500").toString(),
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("300").toString(),
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("100").toString(),
  };

  // Safe Guard (ZERO_ADDRESS) + Users 1 to 4
  const jsonTree0Round2: Record<string, string> = {
    "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Safe Guard address
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("8000").toString(),
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("6000").toString(),
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("3000").toString(),
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("3000").toString(),
  };

  // Safe Guard (ONE_ADDRESS) + Users 1 to 4 (user 4 is new)
  const jsonTree1Round2: Record<string, string> = {
    "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Safe Guard address
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("1000").toString(),
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("800").toString(),
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("600").toString(),
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("500").toString(),
  };

  async function initialSetUpTree0(): Promise<MerkleTree> {
    await multiRewardsDistributor.connect(admin).unpauseDistribution();
    await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);
    const [tree, hexRoot] = createMerkleTree(jsonTree0);
    const hexSafeGuardProof = tree.getHexProof(computeHash(ZERO_ADDRESS, parseEther("1").toString()), Number(0));
    await multiRewardsDistributor
      .connect(admin)
      .updateTradingRewards([0], [hexRoot], [parseEther("5000")], [hexSafeGuardProof]);
    return tree;
  }

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    admin = accounts[0];

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    looksRareToken = await MockERC20.deploy("LooksRare Token", "LOOKS");
    await looksRareToken.deployed();
    await looksRareToken.connect(admin).mint(admin.address, parseEther("1000000").toString());

    const MultiRewardsDistributor = await ethers.getContractFactory("MultiRewardsDistributor");
    multiRewardsDistributor = await MultiRewardsDistributor.deploy(looksRareToken.address);
    await multiRewardsDistributor.deployed();

    // Transfer 10k LOOKS to the MultiRewardsDistributor contract
    await looksRareToken.connect(admin).transfer(multiRewardsDistributor.address, parseEther("10000"));
  });

  describe("#1 - Scenario tests", async () => {
    it("Claim (Single tree)- Users can claim", async () => {
      // Initial setup for tree 0
      let tree = await initialSetUpTree0();
      let hexRoot = tree.getHexRoot();

      // All users except the 4th one claims
      for (const [index, [user, value]] of Object.entries(Object.entries(jsonTree0))) {
        const signedUser = accounts[Number(index)];

        if (Number(index) !== 0 && signedUser !== accounts[3]) {
          // Compute the proof for the user
          const hexProof = tree.getHexProof(computeHash(user, value), Number(index));

          // Verify leaf is matched in the tree with the computed root
          assert.isTrue(tree.verify(hexProof, computeHash(user, value), hexRoot));

          // Check user status
          let claimStatus = await multiRewardsDistributor.canClaim(user, [0], [value], [hexProof]);
          assert.isTrue(claimStatus[0][0]);
          assert.equal(claimStatus[1][0].toString(), value);

          // User claims
          const tx = await multiRewardsDistributor.connect(signedUser).claim([0], [value], [hexProof]);
          await expect(tx).to.emit(multiRewardsDistributor, "Claim").withArgs(user, "1", value, [0], [value]);

          // Proof if still valid but amount is adjusted accordingly
          claimStatus = await multiRewardsDistributor.canClaim(user, [0], [value], [hexProof]);
          assert.isTrue(claimStatus[0][0]);
          assert.deepEqual(claimStatus[1][0], constants.Zero);

          // Cannot double claim
          await expect(multiRewardsDistributor.connect(signedUser).claim([0], [value], [hexProof])).to.be.revertedWith(
            "Rewards: Already claimed"
          );
        }
      }

      // Transfer 10k LOOKS to the multiRewardsDistributor
      await looksRareToken.connect(admin).transfer(multiRewardsDistributor.address, parseEther("10000"));

      [tree, hexRoot] = createMerkleTree(jsonTree0Round2);
      const hexSafeGuardProof = tree.getHexProof(computeHash(ZERO_ADDRESS, parseEther("1").toString()), Number(0));

      let tx = await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards([0], [hexRoot], [parseEther("8000")], [hexSafeGuardProof]);
      await expect(tx).to.emit(multiRewardsDistributor, "UpdateTradingRewards").withArgs("2");

      // All users except the 4th one claims
      for (const [index, [user, value]] of Object.entries(Object.entries(jsonTree0Round2))) {
        const signedUser = accounts[Number(index)];

        if (Number(index) !== 0 && signedUser !== accounts[3]) {
          // Compute the proof for the user
          const hexProof = tree.getHexProof(computeHash(user, value), Number(index));

          // Verify leaf is matched in the tree with the computed root
          assert.isTrue(tree.verify(hexProof, computeHash(user, value), hexRoot));

          // Fetch the amount previous claimed by the user and deduct the amount they will receive
          const amountPreviouslyClaimed = await multiRewardsDistributor.amountClaimedByUserPerTreeId(
            user,
            constants.Zero
          );
          const expectedAmountToReceive = BigNumber.from(value).sub(BigNumber.from(amountPreviouslyClaimed.toString()));

          // Check user status
          let claimStatus = await multiRewardsDistributor.canClaim(user, [0], [value], [hexProof]);
          assert.isTrue(claimStatus[0][0]);
          assert.deepEqual(claimStatus[1][0], expectedAmountToReceive);

          tx = await multiRewardsDistributor.connect(signedUser).claim([0], [value], [hexProof]);
          await expect(tx)
            .to.emit(multiRewardsDistributor, "Claim")
            .withArgs(user, "2", expectedAmountToReceive, [0], [expectedAmountToReceive]);

          claimStatus = await multiRewardsDistributor.canClaim(user, [0], [value], [hexProof]);
          assert.isTrue(claimStatus[0][0]);
          assert.deepEqual(claimStatus[1][0], constants.Zero);

          assert.equal((await multiRewardsDistributor.amountClaimedByUserPerTreeId(user, "0")).toString(), value);

          // Cannot double claim
          await expect(multiRewardsDistributor.connect(signedUser).claim([0], [value], [hexProof])).to.be.revertedWith(
            "Rewards: Already claimed"
          );
        }
      }

      // User (accounts[3]) claims for two periods
      const lateClaimer = accounts[3];
      const expectedAmountToReceive = parseEther("3000");

      // Compute the proof for the user4
      const hexProof = tree.getHexProof(computeHash(lateClaimer.address, expectedAmountToReceive.toString()), 3);

      // Verify leaf is matched in the tree with the computed root
      assert.isTrue(
        tree.verify(hexProof, computeHash(lateClaimer.address, expectedAmountToReceive.toString()), hexRoot)
      );

      tx = await multiRewardsDistributor.connect(lateClaimer).claim([0], [expectedAmountToReceive], [hexProof]);
      await expect(tx)
        .to.emit(multiRewardsDistributor, "Claim")
        .withArgs(lateClaimer.address, "2", expectedAmountToReceive, [0], [expectedAmountToReceive]);
    });

    it("Claim (Two/three trees) - Users can claim", async () => {
      /** 0. Initial set up for trees and first round
       */
      await multiRewardsDistributor.connect(admin).unpauseDistribution();

      let tx = await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);
      await expect(tx).to.emit(multiRewardsDistributor, "NewTree").withArgs(0);

      tx = await multiRewardsDistributor.connect(admin).addNewTree(ONE_ADDRESS);
      await expect(tx).to.emit(multiRewardsDistributor, "NewTree").withArgs(1);

      const [tree0, hexRoot0] = createMerkleTree(jsonTree0);
      const [tree1, hexRoot1] = createMerkleTree(jsonTree1);
      const hexSafeGuardProofTree0 = tree0.getHexProof(
        computeHash(ZERO_ADDRESS, parseEther("1").toString()),
        Number(0)
      );
      const hexSafeGuardProofTree1 = tree1.getHexProof(computeHash(ONE_ADDRESS, parseEther("1").toString()), Number(0));

      await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards(
          [0, 1],
          [hexRoot0, hexRoot1],
          [parseEther("5000"), parseEther("500")],
          [hexSafeGuardProofTree0, hexSafeGuardProofTree1]
        );

      /** 1. Round 1 - Claiming start
       */

      // 1.1 User1 claims (accounts 1 --> position 1 in both trees)
      let user = accounts[1].address;
      let value0 = parseEther("5000").toString();
      let value1 = parseEther("500").toString();
      const totalValue = parseEther("5500");
      let hexProof0 = tree0.getHexProof(computeHash(user, value0), 1);
      let hexProof1 = tree1.getHexProof(computeHash(user, value1), 1);
      assert.isTrue(tree0.verify(hexProof0, computeHash(user, value0), hexRoot0));
      assert.isTrue(tree1.verify(hexProof1, computeHash(user, value1), hexRoot1));
      let claimStatus = await multiRewardsDistributor.canClaim(user, [0, 1], [value0, value1], [hexProof0, hexProof1]);
      assert.isTrue(claimStatus[0][0]);
      assert.isTrue(claimStatus[0][1]);
      assert.equal(claimStatus[1][0].toString(), value0);
      assert.equal(claimStatus[1][1].toString(), value1);

      // User claims
      tx = await multiRewardsDistributor.connect(accounts[1]).claim([0, 1], [value0, value1], [hexProof0, hexProof1]);
      await expect(tx)
        .to.emit(multiRewardsDistributor, "Claim")
        .withArgs(user, "1", totalValue, [0, 1], [value0, value1]);
      await expect(tx).to.emit(looksRareToken, "Transfer").withArgs(multiRewardsDistributor.address, user, totalValue);

      // 1.2 User2 claims in 2 parts
      user = accounts[2].address;
      value0 = parseEther("3000").toString();
      value1 = parseEther("300").toString();
      hexProof0 = tree0.getHexProof(computeHash(user, value0), 2);
      hexProof1 = tree1.getHexProof(computeHash(user, value1), 2);
      assert.isTrue(tree0.verify(hexProof0, computeHash(user, value0), hexRoot0));
      assert.isTrue(tree1.verify(hexProof1, computeHash(user, value1), hexRoot1));
      claimStatus = await multiRewardsDistributor.canClaim(user, [0, 1], [value0, value1], [hexProof0, hexProof1]);
      assert.isTrue(claimStatus[0][0]);
      assert.isTrue(claimStatus[0][1]);
      assert.equal(claimStatus[1][0].toString(), value0);
      assert.equal(claimStatus[1][1].toString(), value1);

      // User2 claims the tree 1 first
      tx = await multiRewardsDistributor.connect(accounts[2]).claim([1], [value1], [hexProof1]);
      await expect(tx).to.emit(multiRewardsDistributor, "Claim").withArgs(user, "1", value1, [1], [value1]);
      await expect(tx).to.emit(looksRareToken, "Transfer").withArgs(multiRewardsDistributor.address, user, value1);

      // User2 claims the tree 0 after
      tx = await multiRewardsDistributor.connect(accounts[2]).claim([0], [value0], [hexProof0]);
      await expect(tx).to.emit(multiRewardsDistributor, "Claim").withArgs(user, "1", value0, [0], [value0]);
      await expect(tx).to.emit(looksRareToken, "Transfer").withArgs(multiRewardsDistributor.address, user, value0);

      /** 2. Set up for second round
       */

      /** 3. Round 2 - Claiming start
       */

      /** 4. Set up for third tree and third round with only 1 tree updated
       */
    });
  });

  describe("#2 - Revertions of user functions", async () => {
    it("Cannot claim if array lengthes differ", async () => {
      // Initial setup
      const tree = await initialSetUpTree0();
      // Compute the proof for the user
      const hexProof = tree.getHexProof(computeHash(accounts[1].address, parseEther("5000").toString()), 1);

      await expect(
        multiRewardsDistributor.connect(accounts[1]).claim([0, 1], [parseEther("5000")], [hexProof])
      ).to.be.revertedWith("Rewards: Wrong lengths");

      await expect(
        multiRewardsDistributor.connect(accounts[1]).claim([0], [parseEther("5000"), parseEther("1")], [hexProof])
      ).to.be.revertedWith("Rewards: Wrong lengths");

      await expect(
        multiRewardsDistributor.connect(accounts[1]).claim([0], [parseEther("5000")], [hexProof, hexProof])
      ).to.be.revertedWith("Rewards: Wrong lengths");
    });

    it("Cannot claim twice", async () => {
      // Initial setup
      const tree = await initialSetUpTree0();
      // Compute the proof for the user
      const hexProof = tree.getHexProof(computeHash(accounts[1].address, parseEther("5000").toString()), 1);
      await multiRewardsDistributor.connect(accounts[1]).claim([0], [parseEther("5000")], [hexProof]);

      await expect(
        multiRewardsDistributor.connect(accounts[1]).claim([0], [parseEther("5000")], [hexProof])
      ).to.be.revertedWith("Rewards: Already claimed");
    });

    it("Cannot claim if paused or tree nonexistent", async () => {
      const randomProof = [
        "0xe9cb62a4a45543a0c652e488f81c3baa93c972fd0c6059a7897348da7ed660ce",
        "0xe5db38278b372bf1d0ad4db5642f57f0b9212ddb6b43d62d449d34245c71b2c8",
      ];

      // Paused
      await expect(
        multiRewardsDistributor.connect(accounts[1]).claim([0], [parseEther("5000")], [randomProof])
      ).to.be.revertedWith("Pausable: paused");

      await multiRewardsDistributor.connect(admin).unpauseDistribution();

      await expect(
        multiRewardsDistributor.connect(accounts[1]).claim([0], [parseEther("5000")], [randomProof])
      ).to.be.revertedWith("Rewards: Tree nonexistent");
    });

    it("Cannot claim with wrong proofs, if not in the tree, or someone's else proof", async () => {
      // Initial setup
      const tree = await initialSetUpTree0();
      // Compute the proof for the user 1
      const hexProof = tree.getHexProof(computeHash(accounts[1].address, parseEther("5000").toString()), 1);

      // Amount matches the proof but not the user
      await expect(
        multiRewardsDistributor.connect(accounts[2]).claim([0], [parseEther("5000")], [hexProof])
      ).to.be.revertedWith("Rewards: Invalid proof");

      // Amount matches the user but it is the wrong proof
      await expect(
        multiRewardsDistributor.connect(accounts[2]).claim([0], [parseEther("3000")], [hexProof])
      ).to.be.revertedWith("Rewards: Invalid proof");

      await multiRewardsDistributor.connect(admin).addNewTree(ONE_ADDRESS);

      // Wrong tree
      await expect(
        multiRewardsDistributor.connect(accounts[1]).claim([1], [parseEther("5000")], [hexProof])
      ).to.be.revertedWith("Rewards: Invalid proof");
    });

    it("Cannot claim if more than tree limit", async () => {
      await multiRewardsDistributor.connect(admin).unpauseDistribution();
      await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);

      const [tree, hexRoot] = createMerkleTree(jsonTree0);
      const hexSafeGuardProofTree0 = tree.getHexProof(computeHash(ZERO_ADDRESS, parseEther("1").toString()), Number(0));

      // Maximum amount is set at 5000 LOOKS - 1 wei of LOOKS
      await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards([0], [hexRoot], [parseEther("5000").sub("1")], [hexSafeGuardProofTree0]);

      // Compute the proof for the user 1
      const hexProof = tree.getHexProof(computeHash(accounts[1].address, parseEther("5000").toString()), 1);

      await expect(
        multiRewardsDistributor.connect(accounts[1]).claim([0], [parseEther("5000")], [hexProof])
      ).to.be.revertedWith("Rewards: Amount higher than max");
    });
  });

  describe("#3 - Owner functions", async () => {
    it("Owner - Cannot withdraw immediately after pausing", async () => {
      const depositAmount = parseEther("10000");
      await looksRareToken.connect(admin).transfer(multiRewardsDistributor.address, depositAmount);

      let tx = await multiRewardsDistributor.connect(admin).unpauseDistribution();
      await expect(tx).to.emit(multiRewardsDistributor, "Unpaused");

      tx = await multiRewardsDistributor.connect(admin).pauseDistribution();
      await expect(tx).to.emit(multiRewardsDistributor, "Paused");

      await expect(multiRewardsDistributor.connect(admin).withdrawTokenRewards(depositAmount)).to.be.revertedWith(
        "Owner: Too early to withdraw"
      );

      const lastPausedTimestamp = await multiRewardsDistributor.lastPausedTimestamp();
      const BUFFER_ADMIN_WITHDRAW = await multiRewardsDistributor.BUFFER_ADMIN_WITHDRAW();

      // Jump in time to the period where it becomes possible to claim
      await increaseTo(lastPausedTimestamp.add(BUFFER_ADMIN_WITHDRAW).add(BigNumber.from("1")));

      tx = await multiRewardsDistributor.connect(admin).withdrawTokenRewards(depositAmount);
      await expect(tx).to.emit(multiRewardsDistributor, "TokenWithdrawnOwner").withArgs(depositAmount);
    });

    it("Owner - Cannot set up the same safe guard twice", async () => {
      await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);
      await expect(multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS)).to.be.revertedWith(
        "Owner: Safe guard already used'"
      );
    });

    it("Owner - Cannot update rewards if wrong lengths or tree is not existent", async () => {
      const [tree0, hexRoot0] = createMerkleTree(jsonTree0);
      const hexSafeGuardProofTree0 = tree0.getHexProof(
        computeHash(ZERO_ADDRESS, parseEther("1").toString()),
        Number(0)
      );

      await expect(
        multiRewardsDistributor
          .connect(admin)
          .updateTradingRewards([0, 1], [hexRoot0], [parseEther("5000")], [hexSafeGuardProofTree0])
      ).to.be.revertedWith("Owner: Wrong lengths");

      await expect(
        multiRewardsDistributor
          .connect(admin)
          .updateTradingRewards([0], [hexRoot0, hexRoot0], [parseEther("5000")], [hexSafeGuardProofTree0])
      ).to.be.revertedWith("Owner: Wrong lengths");

      await expect(
        multiRewardsDistributor
          .connect(admin)
          .updateTradingRewards([0], [hexRoot0], [parseEther("5000"), parseEther("30")], [hexSafeGuardProofTree0])
      ).to.be.revertedWith("Owner: Wrong lengths");

      await expect(
        multiRewardsDistributor
          .connect(admin)
          .updateTradingRewards([0], [hexRoot0], [parseEther("5000")], [hexSafeGuardProofTree0, hexSafeGuardProofTree0])
      ).to.be.revertedWith("Owner: Wrong lengths");

      await expect(
        multiRewardsDistributor
          .connect(admin)
          .updateTradingRewards([0], [hexRoot0], [parseEther("5000")], [hexSafeGuardProofTree0])
      ).to.be.revertedWith("Owner: Tree nonexistent");
    });

    it("Owner - Owner cannot invert the hex roots", async () => {
      await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);
      await multiRewardsDistributor.connect(admin).addNewTree(ONE_ADDRESS);

      const [tree0, hexRoot0] = createMerkleTree(jsonTree0);
      const [tree1, hexRoot1] = createMerkleTree(jsonTree1);
      const hexSafeGuardProofTree0 = tree0.getHexProof(
        computeHash(ZERO_ADDRESS, parseEther("1").toString()),
        Number(0)
      );
      const hexSafeGuardProofTree1 = tree1.getHexProof(computeHash(ONE_ADDRESS, parseEther("1").toString()), Number(0));

      await expect(
        multiRewardsDistributor
          .connect(admin)
          .updateTradingRewards(
            [0, 1],
            [hexRoot1, hexRoot0],
            [parseEther("5000"), parseEther("500")],
            [hexSafeGuardProofTree0, hexSafeGuardProofTree1]
          )
      ).to.be.revertedWith("Owner: Wrong safe guard proofs");
    });

    it("Owner - Owner cannot set twice the same Merkle Root", async () => {
      await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);

      const [tree, hexRoot] = createMerkleTree(jsonTree0);
      const hexSafeGuardProof = tree.getHexProof(computeHash(ZERO_ADDRESS, parseEther("1").toString()), Number(0));

      await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards([0], [hexRoot], [parseEther("5000")], [hexSafeGuardProof]);

      await expect(
        multiRewardsDistributor
          .connect(admin)
          .updateTradingRewards([0], [hexRoot], [parseEther("5000")], [hexSafeGuardProof])
      ).to.be.revertedWith("Owner: Merkle root already used");
    });
  });
});
