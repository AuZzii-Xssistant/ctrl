# Security Policy

\>_ CTRL is a local-first Windows desktop app. It runs PowerShell/batch/Python commands you configure, some elevated (UAC), against your own machine — there's no server, no network service, no account system. Most "security" concerns here are about what a malicious *script or fix entry* could do if imported from an untrusted source, not about attacking CTRL itself over a network.

## Reporting a vulnerability

If you find a real security issue (e.g. a way for a script/import to escape its expected scope, a command-injection path, or something in the CLI's SQL handling beyond the already-documented tradeoff in [`docs/known-issues.md`](docs/known-issues.md)), please open a [private security advisory](https://github.com/AuZzii-Xssistant/ctrl/security/advisories/new) rather than a public issue. If that's not available, email the address on the maintainer's GitHub profile.

Include: what you found, how to reproduce it, and what you think the impact is. No bug bounty — this is a personal project — but real reports get fixed and credited.

## What's explicitly out of scope

- **Anything a `run_as_admin` script/fix does when you configure it yourself.** CTRL elevates what you tell it to elevate; that's the feature, not a vulnerability.
- **The CLI's `update <table> --id N --field value` escape hatch.** Documented, deliberate, and scoped to a local single-user tool — see `docs/known-issues.md`.
- **Imported ScriptStash profiles or WinScript-sourced scripts running arbitrary commands.** You're importing someone else's PowerShell; review it before running it, same as you would any script from the internet.

## Supported versions

Only the latest release is supported. This is a fast-moving, actively-changing project (see `docs/known-issues.md` for current maturity per module) — there's no long-term-support branch.
