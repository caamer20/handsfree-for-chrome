# Security

HandsFree is currently a developer preview. Security fixes will target the latest source and preview release.

Please report vulnerabilities privately through [GitHub’s vulnerability reporting form](https://github.com/caamer20/handsfree-for-chrome/security/advisories/new). Include the affected version, impact, and a minimal reproduction using invented data. Do not open a public issue containing an exploit against users, API keys, or private browsing information.

If private reporting is unavailable, open a public issue asking for a private reporting channel without including vulnerability details.

Routine inputs must remain data, actions must stay within the defined schema, page messages must come from trusted extension contexts, and cancellation must prevent pending actions from starting. Reports involving those boundaries are particularly helpful.
