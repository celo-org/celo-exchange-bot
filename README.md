
---
**IMPORTANT: This project is not currently being maintained. If you want to use please check and update dependencies to solve potential security vulneratibilites of old dependencies**
---

# CELO <-> stable token Exchange Bot

Uses an Azure Key Vault HSM wallet to periodically exchange CELO for stable tokens (specifying a maximum amount, and minimum rate) using the Exchange smart contract and transfer the stable token to a target wallet address.

## Environment variables

The following environment variables are required by this program unless indicated as optional.

- `CELO_PROVIDER`: The HTTP or WebSocket URL of the Celo node to use for all RPCs.
- `CONFIG`: (Optional) A path to a file containing environment variables that will be considered by this program. Uses [dotenv](https://www.npmjs.com/package/dotenv). 
- `GAS_INFLATION_FACTOR`: (Optional) A factor applied to the recommended gas price by Celo nodes for all transactions. Defaults to `2.0`.
- `EXCHANGE_AMOUNT_CELO`: Desired amount of CELO to sell per exchange. Less CELO may be sold if the source account's CELO balance is not sufficient. 
- `EXCHANGE_MAX_ALLOWED_SLIPPAGE`: Maximum slippage amount for an exchange. E.g. `0.01` means max 1% slippage for the exchange.
- `EXCHANGE_MINRATE_STABLETOKEN_PER_CELO`: The minimum price of CELO quoted in the stable token to ever exchange.
- `EXCHANGE_SECS`: (Optional) The number of seconds between each exchange. Defaults to `15`.
- `EXCHANGE_SOURCE_ADDRESS`: The address of the address that will be exchanging CELO for the stable token. Must correspond to an accessible Azure HSM.
- `EXCHANGE_TARGET_ADDRESS`: The recipient of purchased stable token, transferred from the source address to the target address every `TRANSFER_SECS` seconds.
- `STABLE_TOKEN`: The name of the stable token to purchase. Must be either `cUSD` or `cEUR`.
- `TRANSFER_SECS`: (Optional) The number of seconds between each transfer of stable tokens from the source address to the target address. Defaults to `7200`.

Azure-specific environment variables (see [here](https://docs.celo.org/developer-guide/integrations/cloud-hsm) for help getting started with Azure HSMs & getting these values):

- `AZURE_KEY_NAME`: The name of the AKV key.
- `AZURE_VAULT_NAME`: name of the AKV vault.

And when running outside an authenticated Azure container, also specify:

- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`

## Dev

To build:

```bash
yarn install && yarn build
```

To run in dev mode, configure `configs/.env.development`, then run:

```bash
yarn run dev
```

## Docker Image

See `Dockerfile` for build instructions.
