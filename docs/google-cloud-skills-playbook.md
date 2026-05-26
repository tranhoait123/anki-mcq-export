# Google Cloud Skills Playbook

This repo uses selected skills from `google/skills` as implementation guidance. Skills are not a substitute for tests; every code change still needs `npm run test:all`.

## Skill Map

| Skill | Use in this repo | Do not use for |
|:---|:---|:---|
| Gemini API in Agent Platform | `@google/genai`, structured JSON output, context caching, multimodal PDF/image handling, model lifecycle checks, fallback behavior. | Replacing the existing browser-first architecture without a product decision. |
| Firebase Basics | Hosting preview channels, production deploy, SPA rewrites, cache headers, rollback, service account scope. | Database/backend work unless Firebase products are added. |
| WAF Reliability | Retry, key cooldown, rescue split, checkpoint resume, e2e smoke coverage, release rollback. | Promising zero defects. |
| WAF Security | API key safety, local document handling, CI secrets, least-privilege service accounts, dependency hygiene. | Storing user documents or keys on a server. |
| Auth Recipe | Human Firebase deploy auth and GitHub Actions service account auth. | Asking users to upload long-lived service account keys. |
| Cost Optimization | Gemini quota guidance, Firebase Hosting budget checks, avoiding unnecessary backend services. | Adding BigQuery billing export for this small static app unless costs grow. |

## Gemini/API Upgrade Checklist

- Keep `@google/genai` as the Google SDK.
- Keep `gemini-3.1-flash-lite-preview` as the app default/fallback; use `gemini-3.5-flash` or `gemini-3.1-flash-lite` only when a user intentionally chooses them.
- Preserve strict JSON object output with the top-level `questions` array.
- Keep provider/model coercion before runtime calls.
- Warn on legacy Gemini model IDs such as `gemini-2.0-*`, `gemini-1.*`, `gemini-pro`, and `gemini-3-pro-preview`.
- Keep text-only gateway models away from image/PDF requests by falling back to a vision-capable model.
- Treat auth failures as non-splittable; treat quota/server-busy/format/empty responses as retry or rescue candidates.
- Preserve trusted source labels after parsing so model hallucinated source names do not leak into exports.

## Firebase/Release Checklist

- Run `npm run test:all` before any deploy.
- For Firebase-specific implementation work, refresh the Firebase agent skills first with `npx -y skills add firebase/agent-skills -y`.
- Use Firebase Hosting preview channels for PRs.
- Keep the SPA rewrite from `**` to `/index.html`.
- Cache hashed Vite assets immutably, but keep HTML no-cache.
- Confirm production rollback access before major releases.
- Keep GitHub Actions deploy credentials in secrets only.

## Future Backend Decision

Cloud Run only becomes relevant if the project adds a server-side API key proxy, background extraction jobs, or persistent shared storage. If that happens, create a new plan covering service identity, Secret Manager, request size limits, queueing, and user data retention before implementation.
