// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../interfaces/IRewardConvertor.sol";

contract MockRewardConvertor is IRewardConvertor {
    address public immutable FEE_SHARING_ADDRESS;

    constructor(address _feeSharingAddress) {
        FEE_SHARING_ADDRESS = _feeSharingAddress;
    }

    function convert(
        address tokenToSell,
        address tokenToBuy,
        uint256 amount,
        bytes calldata
    ) external override returns (uint256) {
        require(
            msg.sender == FEE_SHARING_ADDRESS,
            "Convert: Not the fee sharing"
        );

        uint256 amountToTransfer = IERC20(tokenToBuy).balanceOf(address(this));

        // Transfer from
        IERC20(tokenToSell).transferFrom(msg.sender, address(this), amount);

        // Transfer to
        IERC20(tokenToBuy).transfer(FEE_SHARING_ADDRESS, amountToTransfer);

        return amountToTransfer;
    }
}
