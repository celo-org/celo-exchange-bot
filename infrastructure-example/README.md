# Azure

This describes how to run the exchange bot in Azure using an Azure Key Vault HSM.

For a new instance:

```bash
az login
az account set --subscription {YOUR_SUB}

export RESOURCE_GROUP={YOUR_RG}
export CONTAINER_NAME={YOUR_CONTAINER_NAME}
export KEYVAULT_NAME={YOUR_VAULT_NAME}
```

## Create a managed identity, add it to container-parameters and grant it access to keyvault

It's easiest to use a managed identity that the bot uses to access the HSM in Azure key vault.

If a managed identity already exists for the bot, you can get it by clicking on the managed identity resource and looking under `properties -> Resource ID`, then just add that string to the container-parameters file. If not, you can create a new managed identity with the following command:

```bash
az identity create \
  --resource-group $RESOURCE_GROUP \
  --name $CONTAINER_NAME
```

The command will output some json, and the string you need to use for `userAssignedIdentity.value` in the container file will be under the `id` field. You can then grant the new managed identity access to the Key Vault via the Azure Portal under the Key Vault's Access Policies. You should give the managed identity the following permissions [get, list, sign] on the Key Vault. You can locate your identity by the `clientId` that's outputted from the previous command.

## Create or update a deployment
When deploying or updating an instane of the bot, use the command below and replace the placeholders `CONF_FILE`, `STABLE_TOKEN` and `CONTAINER_NAME` with the appropiate values depending on the entity and token and confirm that the logs look good once the deployment is finished. The path to `example-container.json` file is intended to be used as the `CONF_FILE`, and the `@` is intentional.

```
az deployment group create \
  --resource-group {RESOURCE_GROUP} \
  --template-file container-template.json \
  --parameters @{CONF_FILE} \
  --parameters containerName={CONTAINER_NAME}
```

## View logs
```
az container logs --name $CONTAINER_NAME --resource-group $RESOURCE_GROUP
```
