#!/usr/bin/env bash
# One-time Azure setup for the MacroFactor -> Garmin read path.
# Run from macrofactor-glance/:  cp .env.example .env && edit AZ_SUBSCRIPTION && ./infra/azure.sh
# Idempotent: safe to re-run. Re-running rotates nothing unless you pass --new-sas.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env (copy .env.example)"; exit 1; }
set -a; . ./.env; set +a
: "${AZ_SUBSCRIPTION:?set AZ_SUBSCRIPTION in .env (PROPHASE tenant subscription id)}"

NEW_SAS=0; [ "${1:-}" = "--new-sas" ] && NEW_SAS=1

az account set --subscription "$AZ_SUBSCRIPTION"

az group create -n "$AZ_RG" -l "$AZ_LOCATION" --tags owner=gordon purpose=personal-garmin -o none

if ! az storage account show -n "$AZ_STORAGE" -g "$AZ_RG" -o none 2>/dev/null; then
  az storage account create -n "$AZ_STORAGE" -g "$AZ_RG" -l "$AZ_LOCATION" \
    --kind StorageV2 --sku Standard_LRS --access-tier Hot \
    --https-only true --min-tls-version TLS1_2 \
    --allow-blob-public-access false --allow-shared-key-access true -o none
fi

KEY=$(az storage account keys list -n "$AZ_STORAGE" -g "$AZ_RG" --query '[0].value' -o tsv)
AUTH=(--account-name "$AZ_STORAGE" --account-key "$KEY")

az storage container create -n "$AZ_CONTAINER" --public-access off "${AUTH[@]}" -o none

# Seed the blob so the watch has something to read before the first Shortcut run.
if ! az storage blob exists -c "$AZ_CONTAINER" -n "$AZ_BLOB" "${AUTH[@]}" --query exists -o tsv | grep -q true; then
  az storage blob upload -c "$AZ_CONTAINER" -n "$AZ_BLOB" -f docs/state.example.json \
    --content-type application/json --content-cache-control no-cache "${AUTH[@]}" -o none
fi

# Stored access policies on the container. SAS tokens reference these, so you can
# revoke a leaked token by deleting/editing the policy instead of rotating the account key.
EXPIRY=$(date -u -d '+1 year' +%Y-%m-%dT%H:%MZ 2>/dev/null || date -u -v+1y +%Y-%m-%dT%H:%MZ)
for P in "watch-read:r" "phone-write:cw"; do
  NAME=${P%%:*}; PERM=${P##*:}
  if az storage container policy show -c "$AZ_CONTAINER" -n "$NAME" "${AUTH[@]}" -o none 2>/dev/null; then
    [ $NEW_SAS = 1 ] && az storage container policy update -c "$AZ_CONTAINER" -n "$NAME" --permissions "$PERM" --expiry "$EXPIRY" "${AUTH[@]}" -o none
  else
    az storage container policy create -c "$AZ_CONTAINER" -n "$NAME" --permissions "$PERM" --expiry "$EXPIRY" "${AUTH[@]}" -o none
  fi
done

BLOB_URL="https://${AZ_STORAGE}.blob.core.windows.net/${AZ_CONTAINER}/${AZ_BLOB}"
sas() { az storage blob generate-sas -c "$AZ_CONTAINER" -n "$AZ_BLOB" --policy-name "$1" --https-only "${AUTH[@]}" -o tsv; }
READ_SAS_URL="${BLOB_URL}?$(sas watch-read)"
WRITE_SAS_URL="${BLOB_URL}?$(sas phone-write)"

# Write back into .env (never committed).
tmp=$(mktemp)
grep -vE '^(BLOB_URL|READ_SAS_URL|WRITE_SAS_URL)=' .env > "$tmp"
{ echo "BLOB_URL=$BLOB_URL"; echo "READ_SAS_URL=$READ_SAS_URL"; echo "WRITE_SAS_URL=$WRITE_SAS_URL"; } >> "$tmp"
mv "$tmp" .env; chmod 600 .env

echo "Done. Values are in .env:"
echo "  READ_SAS_URL  -> Connect IQ app setting 'Blob URL'"
echo "  WRITE_SAS_URL -> 'MF Push' Shortcut, first Text action"
echo "Smoke test:  curl -sI \"\$READ_SAS_URL\" | grep -i content-type   (must say application/json)"
