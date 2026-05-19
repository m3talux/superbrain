# Security Policy

## Supported versions

SuperBrain is in active development. Security fixes are applied to the latest
`main`; there is no back-port window while the project is pre-1.0.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's [security advisories][advisories] ("Report a
vulnerability") or by email to **alex@weaviate.io**. Include:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- affected version / commit.

You can expect an acknowledgement within a few days. Once a fix is available and
released, the report will be disclosed with credit to the reporter (unless you
prefer to remain anonymous).

## Scope notes

SuperBrain runs entirely locally: it reads Claude Code hook input, writes
markdown into a vault you own, and may spawn a local `claude -p` / background
process. It has no network service and stores no secrets. The most relevant
classes of issue are therefore: path traversal / writing outside the configured
vault, unsafe handling of untrusted note content, and command construction in
the distiller spawn path. Reports in these areas are especially appreciated.

[advisories]: https://github.com/m3talux/superbrain/security/advisories/new
