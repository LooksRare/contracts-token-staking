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

describe("MultiRewardsDistributor", () => {
  let looksRareToken: Contract;
  let multiRewardsDistributor: Contract;

  let admin: SignerWithAddress;
  let accounts: SignerWithAddress[];

  let tree: MerkleTree;
  let hexRoot: string;

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
    it("Claim - Users can claim", async () => {
      await multiRewardsDistributor.connect(admin).addNewTree(constants.AddressZero);

      // Dummy + Users 1 to 4
      const json = {
        "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Dummy address
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

      let hexDummyProof = tree.getHexProof(computeHash(constants.AddressZero, parseEther("1").toString()), Number(0));

      let tx = await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards([0], [hexRoot], [parseEther("5000")], [hexDummyProof]);
      expect(tx).to.emit(multiRewardsDistributor, "UpdateTradingRewards").withArgs("1");

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

      // Dummy + Users 1 to 4 (10k rewards added)
      const jsonRound2 = {
        "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Dummy address
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

      hexDummyProof = tree.getHexProof(computeHash(constants.AddressZero, parseEther("1").toString()), Number(0));

      tx = await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards([0], [hexRoot], [parseEther("8000")], [hexDummyProof]);
      expect(tx).to.emit(multiRewardsDistributor, "UpdateTradingRewards").withArgs("2");

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
  });

  describe("#2 - Owner functions", async () => {
    it("Owner - Owner cannot withdraw immediately after pausing", async () => {
      const depositAmount = parseEther("10000");

      // Transfer funds to the mockLooksRareToken
      await looksRareToken.connect(admin).transfer(multiRewardsDistributor.address, depositAmount);

      let tx = await multiRewardsDistributor.connect(admin).unpauseDistribution();
      expect(tx).to.emit(multiRewardsDistributor, "Unpaused");

      tx = await multiRewardsDistributor.connect(admin).pauseDistribution();
      expect(tx).to.emit(multiRewardsDistributor, "Paused");

      await expect(multiRewardsDistributor.connect(admin).withdrawTokenRewards(depositAmount)).to.be.revertedWith(
        "Owner: Too early to withdraw"
      );

      const lastPausedTimestamp = await multiRewardsDistributor.lastPausedTimestamp();
      const BUFFER_ADMIN_WITHDRAW = await multiRewardsDistributor.BUFFER_ADMIN_WITHDRAW();

      // Jump in time to the period where it becomes possible to claim
      await increaseTo(lastPausedTimestamp.add(BUFFER_ADMIN_WITHDRAW).add(BigNumber.from("1")));

      tx = await multiRewardsDistributor.connect(admin).withdrawTokenRewards(depositAmount);
      expect(tx).to.emit(multiRewardsDistributor, "TokenWithdrawnOwner").withArgs(depositAmount);
    });

    it("Owner - Owner cannot set twice the same Merkle Root", async () => {
      await multiRewardsDistributor.connect(admin).addNewTree(constants.AddressZero);

      // Dummy + Users 1 to 4
      const json = {
        "0x0000000000000000000000000000000000000000": parseEther("1").toString(), // Dummy address
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
      const hexDummyProof = tree.getHexProof(computeHash(constants.AddressZero, parseEther("1").toString()), Number(0));

      await multiRewardsDistributor
        .connect(admin)
        .updateTradingRewards([0], [hexRoot], [parseEther("5000")], [hexDummyProof]);

      await expect(
        multiRewardsDistributor
          .connect(admin)
          .updateTradingRewards([0], [hexRoot], [parseEther("5000")], [hexDummyProof])
      ).to.be.revertedWith("Owner: Merkle root already used");
    });
  });
});
