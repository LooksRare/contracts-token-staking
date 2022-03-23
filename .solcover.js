module.exports = {
  silent: true,
  measureStatementCoverage: true,
  measureFunctionCoverage: true,
  skipFiles: ["interfaces", "test", "tokenStaking/OperatorControllerForRewards.sol"],
  configureYulOptimizer: true,
};
