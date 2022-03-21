// SPDX-License-Identifier: MIT
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

abstract contract TestHelpers {
    function _parseEther(uint256 value) internal pure returns (uint256) {
        return value * 1e18;
    }

    function _parseEtherWithFloating(uint256 value, uint8 floatingDigits)
        internal
        pure
        returns (uint256)
    {
        assert(floatingDigits <= 18);
        return value * (10**(18 - floatingDigits));
    }
}
