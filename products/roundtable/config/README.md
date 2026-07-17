# Roundtable Local Configuration

This directory belongs only to the standalone roundtable product.

- `data-root.local.txt` may override the roundtable product data directory with an absolute local path.
- `workspace.local.json` may record user-local workspace selection state.
- Other `*.local.*` files are ignored by Git.

Session state remains under `<workspace>/.web-agents`; dedicated browser profiles, launcher receipts, and logs belong under `../data`.
