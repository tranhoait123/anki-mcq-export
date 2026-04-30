# Architecture Notes

This app is intentionally kept as a browser-first React/Vite application. Refactors should preserve behavior first, then improve module boundaries in small steps.

## Current Boundaries

- `src/App.tsx` is the composition shell: it wires hooks, renders UI, and forwards event handlers.
- `src/hooks/*` owns React stateful workflows that are reused or complex enough to test/refactor separately.
- `src/core/*` owns domain and provider logic that should not import UI components.
- `src/core/brain/index.ts` remains the public facade for AI extraction APIs so existing imports such as `./core/brain` keep working.
- `src/core/brain/batching.ts` owns source labels, adaptive sizing, DOCX/PDF batch helpers, and file hashing.
- `src/utils/*` contains shared pure helpers and infrastructure policies such as retry/key rotation.
- `src/ui/*` contains presentational components.
- `src/ui/fileUploader/*` contains upload-only helpers/components for chunk reading, DOCX preparation, file badges, and upload list/dropzone UI.
- `src/ui/mcqDisplay/*` contains the MCQ result list toolbar, cards, explanation blocks, and virtualization helpers.
- `src/ui/results/*` contains small result-panel sections used by `src/ui/ResultsPanel.tsx`.

## Refactor Rules

- Keep public data shapes stable unless a migration plan and tests exist.
- Move code by responsibility, not by file-size alone.
- Prefer one behavior-preserving extraction per commit.
- Run at least `npm run typecheck`, `npm run lint`, and targeted tests after each extraction.
- Run `npm run test:all` before considering a refactor complete.
- Do not let feature modules import from `App.tsx`; flow should stay `utils/core/hooks/ui -> App`.

## Next Safe Extractions

- Keep `src/core/brain/index.ts` as the stable facade while shrinking large orchestration files only when tests make the move low risk.
- Split large presentational panels into subcomponents when a section has clear inputs and no side effects.
- Move shared hook argument types into local `*.types.ts` files only if duplicated prop bags start making edits risky.
- Consider a future `src/features/*` layer only after generation/export/review boundaries become stable across multiple changes.
