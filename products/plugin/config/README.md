# Plugin Local Configuration

This directory belongs only to the normal plugin product.

- `allowed-directories.local.txt` controls filesystem mutation roots for the plugin services.
- Other `*.local.*` files may contain machine-specific plugin settings.
- Local configuration files are ignored by Git and must not contain roundtable settings.

Runtime permissions, audit records, saved images, and tool results belong under `../data`.
