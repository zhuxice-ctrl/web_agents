# webAgents Browser Automation Design

## Goal

Add a small terminal-controlled browser automation layer that can dispatch existing webAgents council prompts to ChatGPT, DeepSeek, Doubao, and Gemini pages.

## Scope

This version only handles prompt dispatch:

- Read `agent-sessions/<session>/prompts/round-XX-<model>.md`.
- Open the matching provider page in a persistent browser profile.
- Insert prompt text into the native composer.
- Optionally submit the prompt when explicitly requested.

It does not collect model replies, run multi-round orchestration, solve captcha/login prompts, or modify the legacy browser extension.

## UX

```powershell
.\scripts\council-browser.ps1 -DryRun
.\scripts\council-browser.ps1 -KeepOpen
.\scripts\council-browser.ps1 -Submit
.\scripts\council-browser.ps1 -Models gpt,deepseek -Submit
```

Default behavior is insert-only. `-Submit` is required for real sending.

## Architecture

- `scripts/council-browser.ps1`: PowerShell wrapper for Windows users.
- `scripts/council-browser.mjs`: Node command and Playwright automation.
- `scripts/council-browser.test.mjs`: offline tests for argument parsing and dispatch planning.
- `docs/webagents-browser-automation.md`: usage and safety notes.

The Node script keeps provider selectors in one provider config map so later site-specific fixes stay small.

## Safety

- Dry-run mode never opens a browser.
- Submit is opt-in.
- The automation uses a separate persistent browser profile, not the user's normal Chrome profile.
- Browser profile files are ignored by git.
- Missing selectors fail closed with a visible error.

## Verification

- Run `node --test scripts/council-browser.test.mjs`.
- Run `.\scripts\council-browser.ps1 -DryRun` against an existing council session.
- Live browser tests require Playwright and logged-in provider pages.
