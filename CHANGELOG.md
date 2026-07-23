# Changelog

## 1.0.1 - 2026-07-23

- Kept permission suggestions scoped to the requested directory instead of widening to an existing drive root.
- Added explicit directory-persistent approval metadata alongside one-time approval.
- Added audited, permission-gated `delete_file` support without recursive directory deletion.

## 1.0.0 - 2026-07-23

- Extracted the shared filesystem and permission foundation into an independent package branch.
- Preserved the existing public subpath exports used by web_Agent and TableLLM.
- Added an explicit Node.js 24 runtime contract and independent release policy.
