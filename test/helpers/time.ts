import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";

// Advance the state by one block
export async function advanceBlock(): Promise<void> {
  await network.provider.send("evm_mine");
}

// Advance the block to the passed height
export async function advanceBlockTo(target: BigNumber): Promise<void> {
  const currentBlock = await ethers.provider.getBlockNumber();
  if (target.lt(currentBlock)) {
    throw Error(
      `Target block #(${target}) is lower than current block #(${currentBlock})`
    );
  }

  let numberBlocks = target.sub(currentBlock);

  // hardhat_mine only can move by 256 blocks (256 in hex is 0x100)
  while (numberBlocks.gte(BigNumber.from("256"))) {
    await network.provider.send("hardhat_mine", ["0x100"]);
    numberBlocks = numberBlocks.sub(BigNumber.from("256"));
  }

  if (numberBlocks.eq("1")) {
    await network.provider.send("evm_mine");
  } else if (numberBlocks.eq("15")) {
    // Issue with conversion from hexString of 15 (0x0f instead of 0xF)
    await network.provider.send("hardhat_mine", ["0xF"]);
  } else {
    await network.provider.send("hardhat_mine", [numberBlocks.toHexString()]);
  }
}
