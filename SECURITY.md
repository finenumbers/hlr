# Security Policy

## Supported versions

Security fixes target the `main` branch of this repository and the corresponding
`latest` / semver images published to GHCR.

## Reporting a vulnerability

Please report security issues privately to **security@finenumbers.com** (or the
maintainer email on the GitHub organization). Do not open a public GitHub issue
for vulnerabilities that could expose customer data, credentials, or billing.

Include:

- Affected component (`api`, `worker`, `web`, or package name)
- Version / image digest or commit SHA if known
- Reproduction steps and impact assessment

## Secrets

Never commit or paste into issues:

- SMSC credentials (`SMSC_LOGIN`, `SMSC_PASSWORD`, `SMSC_API_KEY`, `SMSC_CALLBACK_SECRET`)
- `API_KEY_PEPPER`, database passwords, Grafana admin password
- Live API keys (`fnk_live_*`) or session cookies

Use host/env files or your secret store; compose and Portainer stacks read `${VAR}`.
