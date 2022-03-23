// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISwapRouter} from "../../uniswap-interfaces/ISwapRouter.sol";

contract MockUniswapV3Router is ISwapRouter {
    using SafeERC20 for IERC20;

    uint256 public constant PRECISION_MULTIPLIER = 10000;

    address public immutable DEPLOYER;

    uint256 public multiplier;

    constructor() {
        // Useless logic not to use an abstract contract
        DEPLOYER = msg.sender;
    }

    function setMultiplier(uint256 _multiplier) external {
        multiplier = _multiplier;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        amountOut = (params.amountIn * multiplier) / PRECISION_MULTIPLIER;
        IERC20(params.tokenOut).transfer(msg.sender, amountOut);

        return amountOut;
    }

    function exactInput(ExactInputParams calldata) external payable override returns (uint256 amountOut) {
        return 0;
    }

    function exactOutputSingle(ExactOutputSingleParams calldata) external payable override returns (uint256 amountIn) {
        return 0;
    }

    function exactOutput(ExactOutputParams calldata) external payable override returns (uint256 amountIn) {
        return 0;
    }

    function uniswapV3SwapCallback(
        int256,
        int256,
        bytes calldata
    ) external pure override {
        return;
    }
}
