# Changelog

## 1.0.1 - 2026-07-24

- Preserved the public conversation scroll position while models are generating.
- Added an explicit scroll-to-latest control after the full run finishes.
- Kept the conversation viewport bounded and usable on mobile layouts.

## 1.0.0 - 2026-07-23

- Split TableLLM into an independent product branch with no plugin source.
- Replaced the vendored core with the versioned `local-core-v1` dependency.
- Removed tracked machine-local whitelist configuration.
- Updated `marked` to `18.0.7`.
