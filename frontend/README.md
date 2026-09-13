# CoCanvas Frontend (not yet built)

This folder only holds the folder-structure scaffold from Section 17 of the blueprint
(`components/`, `pages/`, `hooks/`, `services/`) plus a `package.json` listing the intended
stack (React/Next.js + TypeScript, per Section 5).

There is no working Next.js app here yet — building the actual UI (workspace list, document
list, editor shell, share modal, etc.) is scoped to the phases after the Core API skeleton
(Section 18, Phases 1 and 5-6). Until then this service is intentionally left out of
`docker-compose.yml` so `docker compose up` doesn't fail on a non-existent build.
