# Question Format Audit

This audit pack is for measuring what the current app can extract from question formats commonly found on Scribd, Studocu, SlideShare, and Quizlet-like study material.

It intentionally does not add new app parsing behavior. The goal is to document format coverage, provide safe synthetic fixtures, and create a repeatable benchmark path.

## Ground Rules

- Do not scrape, bypass login/paywalls, or commit copyrighted exam content.
- Use public documentation only for taxonomy, and use synthetic fixtures for repeatable tests.
- If real files are tested, keep them outside the repo and record only aggregate results.
- Treat SlideShare-style content as exported PDF/image fixtures for this audit, because the app does not directly accept PowerPoint uploads.

## Sources Used For Taxonomy

- Scribd Help: accepted uploads include document, presentation, spreadsheet, and other office-style formats.
- Studocu Help: accepted uploads are PDF, DOC, and DOCX, with scan/low-resolution files called out as restricted/problematic.
- Slideshare upload page: supported file families include PowerPoint, PDF, and Word.
- Quizlet Help: import separates terms/definitions with comma, tab, or dash, and rows with semicolon or newline.
- Quizlet Learn: practice formats include multiple choice, true/false, and written questions.
- General LMS/question-bank docs such as Moodle, Canvas, and Respondus are used only to widen question-type taxonomy.

## How To Use This Pack

1. Review `coverage_matrix.md` and adjust owner/date/model columns before a real benchmark run.
2. Use `fixtures/` as safe synthetic source material for manual uploads or for future fixture generation.
3. Review `taxonomy.md` when adding new matrix rows; it is broader than the first runnable fixture pack.
4. Run deterministic baseline tests:

```bash
npm test -- --run src/audit/questionFormatCoverage.test.ts
```

4. For AI extraction benchmark, use the same provider/model/settings across all runs and record:
   - extracted count vs expected count
   - option/answer structure correctness
   - source trace quality
   - safety issues such as hallucination, wrong merges, or unsafe duplicate skips

## Result Labels

- `Supported`: at least 95% of expected questions extracted and answers are structurally usable.
- `Partial`: some extraction works, but missing questions, answer uncertainty, or review is needed.
- `Unsupported`: current app cannot ingest the file or extraction is not reliable enough.
- `TBD`: not yet run through the current app.
