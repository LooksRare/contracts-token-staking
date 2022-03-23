// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISwapRouter} from "../../uniswap-interfaces/ISwapRouter.sol";

contract MockFaultyUniswapV3Router is ISwapRouter {
    using SafeERC20 for IERC20;

    address public immutable DEPLOYER;

    constructor() {
        // Useless logic not to use an abstract contract
        DEPLOYER = msg.sender;
    }

    function exactInputSingle(ExactInputSingleParams calldata) external payable override returns (uint256) {
        revert();
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
