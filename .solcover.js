module.exports = {
  silent: true,
  measureStatementCoverage: true,
  measureFunctionCoverage: true,
  skipFiles: [
    "interfaces",
    "uniswap-interfaces",
    "test",
    "OperatorControllerForRewards.sol",
    "OperatorControllerForRewardsV2.sol",
  ],
  configureYulOptimizer: true,
};
