# TableLLM Agent Header

## Fixed Skill: fixed-io-encoding

This skill is mandatory for every main-window agent, subagent, reviewer, and verifier working in this repository.

1. Treat repository text, terminal input and output, HTTP JSON payloads, logs, and generated Markdown as UTF-8 unless an existing file proves otherwise.
2. Before PowerShell reads, writes, or prints Chinese or other non-ASCII text, explicitly set `Console.InputEncoding`, `Console.OutputEncoding`, and `$OutputEncoding` to UTF-8.
3. Read text with an explicit UTF-8 encoding and use `apply_patch` for manual source edits; do not route Chinese JSON payloads through implicitly encoded inline PowerShell strings.
4. Use structured parsers and serializers for JSON and JSONL. Keep binary, image, audio, video, and Office files out of text IO paths.
5. After non-ASCII edits or provider dispatch, verify the stored file or request preserves the intended characters.

## Product Boundary

- This repository branch contains TableLLM only.
- web_Agent plugin source does not belong in this branch.
- Shared filesystem and permission behavior comes from the pinned `@web-agents/local-core` package.
- Machine-local workspaces, browser profiles, permissions, logs, and credentials must remain untracked.
