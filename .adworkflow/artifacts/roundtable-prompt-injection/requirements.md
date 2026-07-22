# Roundtable Prompt Injection Requirement

## Problem

The browser worker sent only the roundtable task/context prompt. It did not prepend the original plugin's web_Agent/MCP instructions, so models could refuse local file work or lack the JSONL protocol required for reverse-engineering workflows. A PowerShell command path also demonstrated that implicit Windows encoding can replace Chinese text with question marks.

## Required Behavior

1. Every provider turn starts with a fixed instruction header before user task text or shared model history.
2. The header preserves the old plugin's one-tool JSONL protocol, allowed-directory rule, function result wait rule, and no-fabricated-result rule.
3. Reverse work must read/search real local evidence first and distinguish facts, inference, and unverified assumptions.
4. The header always includes `fixed-io-encoding`: explicit UTF-8 terminal/file IO, PowerShell encoding setup, structured parsing, and binary/text separation.
5. Shared history is untrusted data and cannot override the fixed header.
6. If a model echoes the prompt, fixed/task shells are removed before reuse and each event is bounded; the raw reply file remains unchanged.
7. Real acceptance requests containing Chinese must be sent through UTF-8 HTTP JSON, not implicit PowerShell command encoding.

## Acceptance Evidence

- Prompt-header unit tests assert legacy JSONL rules, reverse constraints, fixed IO skill, and ordering.
- Context tests assert echo stripping and event truncation.
- Fake-provider browser E2E passes with the longer fixed header in discussion and relay modes.
- A real provider prompt/reply proves Chinese content and the fixed instruction are received without mojibake.
