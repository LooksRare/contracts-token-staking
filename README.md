# LooksRare Staking

This project contains all smart contracts used for staking and other token economics (excluding the airdrop contract).

It is a hybrid Hardhat repo that also requires Forge to run Solidity tests powered by the [ds-test library](https://github.com/dapphub/ds-test/).

To install Forge, please follow the instructions [here](https://onbjerg.github.io/foundry-book/getting-started/installation.html#using-foundryup).

## Tests

TypeScript tests are included in the `test` folder at the root of this repo.

Solidity tests are included in the `test` folder in the `contracts` folder.

## Example of Forge commands

```shell
forge test
forge test -vvvv
```

## Example of Hardhat commands

```shell
npx hardhat accounts
npx hardhat compile
npx hardhat clean
npx hardhat test
npx hardhat node
npx hardhat help
REPORT_GAS=true npx hardhat test
npx hardhat coverage
npx hardhat run scripts/deploy.ts
TS_NODE_FILES=true npx ts-node scripts/deploy.ts
npx eslint '**/*.{js,ts}'
npx eslint '**/*.{js,ts}' --fix
npx prettier '**/*.{json,sol,md}' --check
npx prettier '**/*.{json,sol,md}' --write
npx solhint 'contracts/**/*.sol'
npx solhint 'contracts/**/*.sol' --fix
```
