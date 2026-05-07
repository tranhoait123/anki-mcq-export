# Current App Capability Report

Date: 2026-05-07

This report checks whether the current app can process the audit taxonomy without adding new parsing or upload features. Results are based on repository inspection and deterministic tests, not on live AI benchmark runs.

## Verification Run

```bash
npm test -- --run src/audit/questionFormatCoverage.test.ts src/utils/pdfProcessor.test.ts src/core/docxNative.test.ts src/utils/dedupe.test.ts src/core/brain.test.ts
```

Result: 5 test files passed, 76 tests passed.

## Input Container Support

| Input/container | Current status | Evidence / reason |
|---|---|---|
| PDF with clean text layer | Supported | PDF Safe Hybrid scores clean pages as `goodText`, creates structured text batches, chunks large sets safely. |
| PDF scan / image-only PDF | Supported, AI-dependent | Scan/empty text layer routes to Vision/PDF raw for Google or rasterized images for compatible providers. Accuracy depends on model and image quality. |
| Mixed PDF text + scan | Supported route, AI-dependent | Mixed pages route to Vision when a range contains scan/suspect pages. |
| PNG/JPG/JPEG/WebP/HEIC image | Supported route, AI-dependent | FileUploader accepts image MIME types and generation sends image inline. |
| DOCX with real text | Supported | Native parser handles A-D/A-E options, Word numbering, highlighted/red/shaded/symbol-marked answers. |
| DOCX with embedded images | Supported route, AI-dependent | DOCX preparation extracts supported embedded images and sends them to Vision. |
| DOCX mostly image/no text | Partial | App warns user to export Word as PDF/image; direct DOCX text extraction is weak. |
| TXT/MD | Supported route, AI-dependent | Uploaded as text and sent to model; no deterministic question parser for arbitrary text. |
| CSV/TSV | Partial/hidden | `useFilePreparation` has a CSV branch, but file picker does not accept `.csv`; drag/drop may still pass depending browser. No structured CSV parser exists. |
| HTML/MHTML | Unsupported direct | File picker does not accept; generic text read may happen only through drag/drop, but no HTML-to-question preparation. |
| RTF/ODT | Unsupported direct | Not accepted by picker and no dedicated reader/parser. User should export PDF/DOCX/TXT. |
| PPT/PPTX/PPS/PPSX/POTX | Unsupported direct | Not accepted by picker and no slide converter. Audit should use exported PDF/images. |
| XLS/XLSX/ODS spreadsheet | Unsupported direct | Not accepted by picker and no spreadsheet parser. User should export CSV/PDF. |
| Audio/video/interactive Quizlet/slide media | Unsupported | App has no audio/video/interactive input path. |

## Question/Layout Capability

| Case | Current status | Evidence / reason |
|---|---|---|
| Standard A-D MCQ | Supported | Prompt/schema and PDF/DOCX tests cover this. |
| Five-option A-E MCQ | Supported | DOCX native test covers five options; prompt asks 4-5 options. |
| More than five options | Partial | Type allows string array, but prompt/schema expectation is 4-5; export paths may expect fixed Anki fields. |
| Same-line options | Supported route, AI-dependent | PDF text analysis marks table-like same-line options as suspect and routes to Vision. |
| Two-column PDF text | Supported route, AI-dependent | Geometry detector marks multi-column risk as suspect, then Vision path is used. |
| Table/question bank rows | Partial | Prompt tells AI to handle tables/CSV, but no deterministic table parser for uploaded text/HTML/CSV. PDF same-line table risk routes to Vision. |
| Shared clinical vignette / item set | Supported for explicit ranges | `sharedCaseContext` tests and PDF text batching prepend the stem for explicit ranges. Vision-only cases depend on model. |
| Case split across pages | Partial | Explicit text case across pages is supported in helper; Vision/PDF chunking overlap helps, but benchmark needed. |
| Answer key inline/marked in DOCX | Supported | DOCX parser reads highlight/red/shading/symbol answer marks. |
| Answer key separate at end | Partial, AI-dependent | Prompt can ask AI to infer, but no deterministic linking/checker. Needs benchmark. |
| No answer key, answer by reasoning | AI-dependent | App can generate answers/explanations, but correctness cannot be verified offline. |
| True/False | Partial, AI-dependent | Prompt says convert true/false; parser accepts 2+ options; no dedicated answer type. |
| Matching | Partial, AI-dependent | Prompt says convert matching; no dedicated matching schema or deterministic parser. |
| Fill-in-the-blank | Partial, AI-dependent | Prompt says convert fill-in; no native cloze schema. |
| Short-answer/written | Partial/Unsupported | App is MCQ-centered; parser requires options >= 2. AI may generate distractors, but audit must mark as converted, not native support. |
| Numerical/calculated | Partial/Unsupported | Only works if already presented as MCQ. No numerical answer/tolerance schema. |
| Ordering/sequencing | Partial | Can be converted to MCQ if model creates options; no native ordering schema. |
| Categorization/matrix | Partial | Table alignment and conversion are model-dependent. |
| Hotspot/image labeling | Unsupported/Partial | Vision can read visible labels/options, but no hotspot coordinate/card schema. |
| Multi-answer/select-all | Partial | `correctAnswer` is a string and may hold `A,C`, but no `answerType`/validation/export semantics. |
| EXCEPT/NOT/SAI negative wording | Supported for dedupe safety, AI-dependent for extraction | Dedupe tests avoid unsafe auto-skip across opposite intent. Answer correctness still model-dependent. |
| K-type/statement-combination | Partial | Can be represented as MCQ options, but needs model benchmark. |
| Assertion-reason | Partial | Can be represented as MCQ options, but needs model benchmark. |
| Extended matching questions | Partial | Shared options across many stems are not a native schema; model may duplicate options. |
| Watermark/footer/header repeats | Partial | Prompt says ignore irrelevant text; no deterministic watermark stripper. |
| OCR lost accents/broken terms | Partial, AI-dependent | Prompt asks contextual repair; deterministic text parser is not designed for this. |
| Handwritten marks/circled answers | AI-dependent | Vision prompt asks handwriting bypass, but no offline guarantee. |
| Blurry/cropped/obstructed images | Partial/Unsupported depending quality | Audit prompt says skip >70% obscured; model benchmark required. |
| Prompt injection inside source document | Partial | System prompt and source override help, but adversarial live benchmark is needed. |
| Duplicate same question with conflicting answer | Supported for safety review | Dedupe tests prevent auto-skip when answer conflicts. |

## Platform Pattern Summary

| Platform pattern | Current app can handle? | Practical recommendation for audit |
|---|---|---|
| Scribd/Studocu PDF text banks | Mostly yes | Benchmark clean PDF, same-line options, answer-key separate, watermark repeats. |
| Scribd/Studocu scan/photo banks | Yes route, AI-dependent | Benchmark with multiple image qualities and count hallucinations separately. |
| Studocu DOCX notes/exams | Mostly yes if DOCX has real text | Benchmark highlight/no-highlight/answer-key-notes cases. |
| SlideShare decks | Only after export to PDF/image | Do not test PPTX direct as supported; classify direct PPTX as unsupported. |
| Quizlet flashcards copied as TXT/MD | Partial | Benchmark term-definition, true/false, matching, written, multi-answer separately. |
| Quizlet CSV/TSV style imports | Partial/hidden | Current picker does not expose CSV; benchmark as TXT/MD or drag/drop CSV and record ingestion limitation. |
| LMS exports/Aiken/GIFT/Respondus | Partial | App may handle through AI text extraction, but no deterministic importer. |

## Biggest Current Gaps

1. Direct file ingest gaps: PPT/PPTX, XLS/XLSX, ODT/RTF/HTML, and visible CSV picker support.
2. Native schema gaps: multi-answer, short answer, numerical, ordering, hotspot, matching as structured non-MCQ types.
3. Deterministic parsing gaps: CSV/table rows, separate answer keys, watermark cleanup, Quizlet delimiter rows.
4. Quality/audit gaps: no automated model benchmark harness yet to fill `AI Benchmark Status` in the matrix.

## Bottom Line

The app can already process the main app-supported containers: PDF, images, DOCX, TXT/MD. It is strongest on standard MCQ, DOCX marked answers, PDF text/scan routing, shared vignettes, and duplicate safety. It is partial or AI-dependent for Quizlet-style flashcards, table banks, separate answer keys, SlideShare exports, true/false/matching/fill-blank conversions, and all non-MCQ-native question types. It cannot directly process PowerPoint/spreadsheets/ODT/HTML/audio/video without user conversion or future feature work.

