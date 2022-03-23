import { assert, expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, constants, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const { parseEther } = utils;

describe("TokenSplitter", () => {
  let looksRareToken: Contract;
  let tokenSplitter: Contract;

  let admin: SignerWithAddress;
  let team: SignerWithAddress;
  let treasury: SignerWithAddress;
  let tradingRewards: SignerWithAddress;
  let newTreasury: SignerWithAddress;
  let randomUser: SignerWithAddress;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    admin = accounts[0];
    team = accounts[1];
    treasury = accounts[2];
    tradingRewards = accounts[3];
    newTreasury = accounts[4];
    randomUser = accounts[10];

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    looksRareToken = await MockERC20.deploy("LOOKS", "Mock LOOKS");
    await looksRareToken.deployed();
    await looksRareToken.connect(admin).mint(admin.address, parseEther("1000000"));
    const TokenSplitter = await ethers.getContractFactory("TokenSplitter");
    tokenSplitter = await TokenSplitter.deploy(
      [team.address, treasury.address, tradingRewards.address],
      ["20", "10", "70"],
      looksRareToken.address
    );
    await tokenSplitter.deployed();
  });

  describe("#1 - System works as expected", async () => {
    it("Release tokens work", async () => {
      assert.deepEqual(await tokenSplitter.calculatePendingRewards(team.address), constants.Zero);

      // Admin adds 1000 LOOKS
      await looksRareToken.connect(admin).transfer(tokenSplitter.address, parseEther("1000"));
      assert.deepEqual(await tokenSplitter.calculatePendingRewards(team.address), parseEther("200"));

      let tx = await tokenSplitter.connect(team).releaseTokens(team.address);
      expect(tx).to.emit(tokenSplitter, "TokensTransferred").withArgs(team.address, parseEther("200"));
      assert.deepEqual((await tokenSplitter.accountInfo(team.address))[1], parseEther("200"));

      // Admin adds 3000 LOOKS
      await looksRareToken.connect(admin).transfer(tokenSplitter.address, parseEther("3000"));

      tx = await tokenSplitter.connect(team).releaseTokens(team.address);
      expect(tx).to.emit(tokenSplitter, "TokensTransferred").withArgs(team.address, parseEther("600"));
      assert.deepEqual((await tokenSplitter.accountInfo(team.address))[1], parseEther("800"));

      tx = await tokenSplitter.connect(treasury).releaseTokens(treasury.address);
      expect(tx).to.emit(tokenSplitter, "TokensTransferred").withArgs(treasury.address, parseEther("400"));

      tx = await tokenSplitter.connect(tradingRewards).releaseTokens(tradingRewards.address);
      expect(tx).to.emit(tokenSplitter, "TokensTransferred").withArgs(tradingRewards.address, parseEther("2800"));

      assert.deepEqual(await looksRareToken.balanceOf(tokenSplitter.address), constants.Zero);
    });

    it("Cannot claim if no share, nothing to claim, or already claimed everything", async () => {
      assert.deepEqual(await tokenSplitter.calculatePendingRewards(randomUser.address), constants.Zero);

      await expect(tokenSplitter.connect(randomUser).releaseTokens(randomUser.address)).to.be.revertedWith(
        "Splitter: Account has no share"
      );

      await expect(tokenSplitter.connect(treasury).releaseTokens(treasury.address)).to.be.revertedWith(
        "Splitter: Nothing to transfer"
      );

      // Admin adds 3000 tokens
      await looksRareToken.connect(admin).transfer(tokenSplitter.address, parseEther("3000"));

      const tx = await tokenSplitter.connect(team).releaseTokens(team.address);
      expect(tx).to.emit(tokenSplitter, "TokensTransferred").withArgs(team.address, parseEther("600"));

      // Cannot transfer again (if no more rewards)
      await expect(tokenSplitter.connect(team).releaseTokens(team.address)).to.be.revertedWith(
        "Splitter: Nothing to transfer"
      );
    });

    it("Random user with no shares can release tokens on someone's behalf and receives nothing", async () => {
      // Admin adds 3000 tokens
      await looksRareToken.connect(admin).transfer(tokenSplitter.address, parseEther("3000"));

      const tx = await tokenSplitter.connect(randomUser).releaseTokens(team.address);
      expect(tx).to.emit(tokenSplitter, "TokensTransferred").withArgs(team.address, parseEther("600"));
      assert.deepEqual(await looksRareToken.balanceOf(randomUser.address), constants.Zero);
    });

    it("Admin can port over the shares of someone", async () => {
      // Admin adds 3000 tokens
      await looksRareToken.connect(admin).transfer(tokenSplitter.address, parseEther("3000"));

      let tx = await tokenSplitter.connect(admin).updateSharesOwner(newTreasury.address, treasury.address);
      expect(tx).to.emit(tokenSplitter, "NewSharesOwner").withArgs(treasury.address, newTreasury.address);

      tx = await tokenSplitter.connect(newTreasury).releaseTokens(newTreasury.address);
      expect(tx).to.emit(tokenSplitter, "TokensTransferred").withArgs(newTreasury.address, parseEther("300"));
      assert.deepEqual(await looksRareToken.balanceOf(newTreasury.address), parseEther("300"));

      await expect(tokenSplitter.connect(treasury).releaseTokens(treasury.address)).to.be.revertedWith(
        "Splitter: Account has no share"
      );
    });
  });

  describe("#2 - Revertions and admin functions", async () => {
    it("Cannot deploy with wrong parameters", async () => {
      const TokenSplitter = await ethers.getContractFactory("TokenSplitter");

      await expect(
        TokenSplitter.deploy([team.address, treasury.address], ["20", "10", "70"], looksRareToken.address)
      ).to.be.revertedWith("Splitter: Length differ");

      await expect(TokenSplitter.deploy([], [], looksRareToken.address)).to.be.revertedWith(
        "Splitter: Length must be > 0"
      );

      await expect(TokenSplitter.deploy([team.address], ["0"], looksRareToken.address)).to.be.revertedWith(
        "Splitter: Shares are 0"
      );
    });

    it("Reversions for shares transfer work as expected", async () => {
      await expect(
        tokenSplitter.connect(admin).updateSharesOwner(treasury.address, treasury.address)
      ).to.be.revertedWith("Owner: New recipient has existing shares");

      await expect(
        tokenSplitter.connect(admin).updateSharesOwner(newTreasury.address, randomUser.address)
      ).to.be.revertedWith("Owner: Current recipient has no shares");
    });

    it("Owner functions are only callable by owner", async () => {
      await expect(
        tokenSplitter.connect(randomUser).updateSharesOwner(randomUser.address, team.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
