# Release Hardening

This project treats `npm run test:all` as the release gate:

```bash
npm run typecheck
npm run lint
npm test
npm run e2e
npm run build
```

## Skill-Guided Checks

- Firebase Basics: use Firebase Hosting preview channels before production, keep the SPA rewrite to `/index.html`, and verify rollback access in the Firebase console.
- Gemini API guidance: review structured JSON output, provider/model compatibility, quota handling, fallback models, and retry/split behavior before changing `src/core/brain/index.ts`, `src/core/brain/*`, `src/utils/models.ts`, or `src/utils/retryStrategy.ts`.
- Google Cloud reliability/security guidance: check API key handling, local-only document processing assumptions, cache headers, and recovery paths for reload/pause/resume.
- Cloud Run Basics is only relevant if a backend service is added later; the current production target is Firebase Hosting.
- See `docs/google-cloud-skills-playbook.md` for the repo-specific skill map and `docs/security.md` for API key, secret, and privacy guidance.

## Manual Release Checklist

- Run `npm run test:all` locally.
- Deploy a Firebase preview channel and open the preview URL.
- Refresh a deep app route to confirm the SPA rewrite still serves `index.html`.
- Smoke test PDF text, PDF scan, DOCX text, DOCX with embedded images, single image upload, and CSV re-import.
- Smoke test expected failures: invalid API key, quota/rate limit, text-only model with image input, pause/resume, reload during processing, and duplicate answer conflict.
- Deploy production only after CI and preview pass.
- Keep GitHub workflow actions on current majors that support the active runner runtime; as of April 29, 2026 this repo uses `actions/checkout@v6` and `actions/setup-node@v6`.

## Smoke Matrix

| Area | Scenario | Expected result |
|:---|:---|:---|
| PDF | Text-layer PDF | Text-first extraction runs and exports CSV/DOCX. |
| PDF | Scan or mixed PDF | Vision/image fallback keeps page overlap and trusted source labels. |
| DOCX | Real text | Native parser preserves MCQ blocks and highlighted answers. |
| DOCX | Embedded images | Vision pass checks `word/media/*` content. |
| Image | Single clear photo | OCR/Vision path extracts MCQs or returns a clear empty result. |
| CSV | Re-import exported CSV | Existing MCQs load without changing Anki export shape. |
| API | Invalid key/token | User sees auth guidance; no retry loop burns quota. |
| API | 429/quota/server busy | Key rotation, cooldown, and retry/rescue behavior engage. |
| Session | Pause/resume/reload | Checkpoint restores completed batches and avoids duplicate appends. |
| Duplicate | Conflicting answers | User review path keeps the conflict visible. |

## Bundle Baseline

Production build baseline after the Vite 8 upgrade and safe chunking pass:

| Asset group | Minified size | Note |
|:---|---:|:---|
| `pdf.worker` | ~1.2 MB | Required by `pdfjs-dist`; excluded from PWA precache by Workbox config. |
| `docx` | ~850 KB | Loaded through DOCX upload/export workflows. |
| `pdf` | ~832 KB | Loaded through PDF text/raster workflows. |
| `index` | ~284 KB | Main app shell after separating vendor, UI, GenAI, PDF, DOCX, and OCR chunks. |
| `genai` | ~267 KB | Google AI SDK chunk. |

Keep PDF/DOCX/OCR imports lazy unless a workflow needs them at startup.
