import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { increaseTo } from "./helpers/block-traveller";
import { computeHash, createMerkleTree } from "./helpers/cryptography";

const { parseEther } = utils;

describe("MultiRewardsDistributor", () => {
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const ONE_ADDRESS = "0x0000000000000000000000000000000000000001";

  let looksRareToken: Contract;
  let multiRewardsDistributor: Contract;

  let admin: SignerWithAddress;
  let accounts: SignerWithAddress[];

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

  describe("#1 - Regular claims work as expected", async () => {
    it("Claim (Single tree)- Users can claim", async () => {
      let tx = await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);
      await expect(tx).to.emit(multiRewardsDistributor, "NewTree").withArgs(0);

      // Safe Guard + Users 1 to 4
      const json = {
        "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Safe Guard address
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
      };

      let [tree, hexRoot] = createMerkleTree(json);
      let hexSafeGuardProof = tree.getHexProof(computeHash(ZERO_ADDRESS, parseEther("1").toString()), Number(0));

      tx = await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards([0], [hexRoot], [parseEther("5000")], [hexSafeGuardProof]);
      await expect(tx).to.emit(multiRewardsDistributor, "UpdateTradingRewards").withArgs("1");

      await multiRewardsDistributor.connect(admin).unpauseDistribution();

      // All users except the 4th one claims
      for (const [index, [user, value]] of Object.entries(Object.entries(json))) {
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
          tx = await multiRewardsDistributor.connect(signedUser).claim([0], [value], [hexProof]);
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

      // Safe Guard + Users 1 to 4 (10k rewards added)
      const jsonRound2 = {
        "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Safe Guard address
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("8000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("6000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("3000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("3000").toString(),
      };

      [tree, hexRoot] = createMerkleTree(jsonRound2);
      hexSafeGuardProof = tree.getHexProof(computeHash(ZERO_ADDRESS, parseEther("1").toString()), Number(0));

      tx = await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards([0], [hexRoot], [parseEther("8000")], [hexSafeGuardProof]);
      await expect(tx).to.emit(multiRewardsDistributor, "UpdateTradingRewards").withArgs("2");

      // All users except the 4th one claims
      for (const [index, [user, value]] of Object.entries(Object.entries(jsonRound2))) {
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
      let tx = await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);
      await expect(tx).to.emit(multiRewardsDistributor, "NewTree").withArgs(0);

      tx = await multiRewardsDistributor.connect(admin).addNewTree(ONE_ADDRESS);
      await expect(tx).to.emit(multiRewardsDistributor, "NewTree").withArgs(1);

      // Safe Guard (ZERO_ADDRESS) + Users 1 to 4
      const jsonTree0 = {
        "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Safe Guard address
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
      };

      // Safe Guard (ONE_ADDRESS) + Users 1 to 3
      const jsonTree1 = {
        "0x0000000000000000000000000000000000000001": parseEther("1").toString(), // Safe Guard address
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("500").toString(),
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("300").toString(),
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("100").toString(),
      };

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

      /** 2. Set up for second round
       */

      /** 3. Round 2 - Claiming start
       */

      /** 4. Set up for third tree and third round with only 1 tree updated
       */
    });
  });

  describe("#2 - Owner functions", async () => {
    it("Owner - Cannot withdraw immediately after pausing", async () => {
      const depositAmount = parseEther("10000");

      // Transfer funds to the mockLooksRareToken
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
      it("Claim (Two/three trees) - Users can claim", async () => {
        await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);
        await expect(multiRewardsDistributor.connect(admin).addNewTree(ONE_ADDRESS)).to.be.revertedWith("NO");
      });

      it("Owner - Owner cannot set twice the same Merkle Root", async () => {
        await multiRewardsDistributor.connect(admin).addNewTree(ZERO_ADDRESS);

        // Safe Guard (ZERO_ADDRESS) + Users 1 to 4
        const json = {
          "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Safe Guard address
          "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": parseEther("5000").toString(),
          "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": parseEther("3000").toString(),
          "0x90F79bf6EB2c4f870365E785982E1f101E93b906": parseEther("1000").toString(),
          "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": parseEther("1000").toString(),
        };

        const [tree, hexRoot] = createMerkleTree(json);
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
});
