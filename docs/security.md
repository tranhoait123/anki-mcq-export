# Security and Privacy

MCQ AnkiGen Pro is designed as a browser-first app. User documents, extracted questions, settings, and cache data are handled locally in the browser through IndexedDB/localStorage unless a chosen AI provider receives request content for extraction.

## API Keys

- Do not commit API keys, Firebase service account JSON, or provider credentials.
- Prefer restricted Google API keys: limit keys to the needed Gemini/AI APIs and rotate keys if they are exposed.
- Use separate Google Cloud projects for experiments, production, and public demos when possible.
- Gateway keys for OpenRouter and ShopAIKey should be treated as billing credentials.

## CI and Firebase

- GitHub Actions must read Firebase deploy credentials from repository secrets.
- Firebase service accounts should have the minimum roles needed for Hosting deploys.
- Production deploy should happen only after `npm run test:all` and a passing preview channel.
- Keep `firebase.json` rewrites and cache headers under test because misconfiguration can break refresh, PWA updates, or static asset caching.

## Document Privacy

- The app should not add server-side uploads without a separate privacy and retention plan.
- Do not log full document contents, API keys, or generated medical content to persistent remote logs.
- When debugging, prefer small synthetic samples over real patient, exam, or school documents.
- Exported CSV/DOCX files may contain sensitive study material; users should store and share them intentionally.

## Dependency Hygiene

- Keep `npm audit` findings triaged before release when feasible.
- Preserve dependency overrides that patch known transitive vulnerabilities.
- Avoid adding backend/cloud dependencies unless the product needs shared storage, server-side processing, or private key handling.
