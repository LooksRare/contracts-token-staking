import { assert, expect } from "chai";
import { BigNumber, constants, Contract, utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const { parseEther } = utils;

describe("LooksRareToken", () => {
  let accounts: SignerWithAddress[];
  let admin: SignerWithAddress;
  let looksRareToken: Contract;
  let premintAmount: BigNumber;
  let cap: BigNumber;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    admin = accounts[0];
    premintAmount = parseEther("200000000"); // 20%
    cap = parseEther("1000000000");

    const LooksRareToken = await ethers.getContractFactory("LooksRareToken");
    looksRareToken = await LooksRareToken.deploy(admin.address, premintAmount, cap);
    await looksRareToken.deployed();
  });

  describe("#1 - Regular user/owner interactions", async () => {
    it("Post-deployment values are correct", async () => {
      assert.deepEqual(await looksRareToken.SUPPLY_CAP(), cap);
      assert.deepEqual(await looksRareToken.totalSupply(), premintAmount);
    });

    it("Owner can mint", async () => {
      const valueToMint = parseEther("100000");
      await expect(looksRareToken.connect(admin).mint(admin.address, valueToMint))
        .to.emit(looksRareToken, "Transfer")
        .withArgs(constants.AddressZero, admin.address, valueToMint);
    });

    it("Owner cannot mint more than cap", async () => {
      let valueToMint = cap.sub(premintAmount);
      await expect(looksRareToken.connect(admin).mint(admin.address, valueToMint))
        .to.emit(looksRareToken, "Transfer")
        .withArgs(constants.AddressZero, admin.address, valueToMint);

      assert.deepEqual(await looksRareToken.totalSupply(), cap);

      valueToMint = BigNumber.from("1");
      await expect(looksRareToken.connect(admin).mint(admin.address, valueToMint)).not.to.emit(
        looksRareToken,
        "Transfer"
      );
      assert.deepEqual(await looksRareToken.totalSupply(), cap);
    });
  });

  describe("#2 - Unusual cases", async () => {
    it("Only owner can mint", async () => {
      await expect(looksRareToken.connect(accounts[1]).mint(admin.address, "0")).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("Cannot deploy if cap is greater than premint amount", async () => {
      const wrongCap = BigNumber.from("0");
      const LooksRareToken = await ethers.getContractFactory("LooksRareToken");
      await expect(LooksRareToken.deploy(admin.address, premintAmount, wrongCap)).to.be.revertedWith(
        "LOOKS: Premint amount is greater than cap"
      );
    });
  });
});
