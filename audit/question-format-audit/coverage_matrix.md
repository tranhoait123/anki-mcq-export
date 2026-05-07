# Coverage Matrix: Scribd / Studocu / SlideShare / Quizlet

Synthetic fixtures only. Do not paste copyrighted question banks into this file.

| ID | Platform Pattern | Format Case | Input Type | Expected Count | Expected Answer Behavior | Current App Route | Deterministic Baseline | AI Benchmark Status | Notes / Risk |
|---|---|---|---|---:|---|---|---|---|---|
| SCD-01 | Scribd/Studocu document bank | Clean PDF text, A-D options, numbered questions | PDF text | 4 | Single answer from visible key/AI reasoning | PDF Safe Hybrid text batch | Supported by `pdfProcessor` text batches | TBD | Baseline parser handles clean Câu/Question markers |
| SCD-02 | Scribd/Studocu document bank | PDF scan page with no text layer | PDF scan | 3 | Single answer inferred from image | PDF Vision | Supported route: scan text layer becomes Vision | TBD | Requires model vision quality |
| SCD-03 | Scribd/Studocu document bank | Mixed text + scan pages | PDF hybrid | 6 | Preserve source page trace | PDF Safe Hybrid, merged Vision range | Supported route: mixed range goes Vision | TBD | Current route favors safety over text speed |
| SCD-04 | Scribd/Studocu document bank | Same-line options `A... B... C... D...` | PDF text | 2 | Do not merge option cells | PDF Vision fallback | Supported route: table risk marked suspect | TBD | Good for tables but more token/vision cost |
| SCD-05 | Scribd/Studocu document bank | Two-column page | PDF text | 8 | Preserve reading order | PDF Vision fallback | Supported route: geometry risk detector exists | TBD | Needs actual PDF geometry for real test |
| SCD-06 | Scribd/Studocu document bank | Answer key at end of file | TXT/PDF | 5 | Link answer by question number | Text/AI extraction | Untested | TBD | High-risk: AI may miss or mismatch key |
| SCD-07 | Scribd/Studocu document bank | Watermark/footer repeated each page | PDF text/scan | 4 | Ignore footer/watermark | Text or Vision | Untested | TBD | Risk of watermark entering question text |
| SCD-08 | Scribd/Studocu document bank | Explanation after each question | PDF/DOCX | 3 | Preserve explanation but do not turn it into options | Text/DOCX native | Partial baseline via DOCX structured text | TBD | Needs answer/explanation accuracy check |
| SCD-09 | Scribd/Studocu document bank | No visible answer key | PDF/DOCX | 4 | AI chooses answer with explanation | Text/Vision | Route supported, correctness AI-dependent | TBD | Cannot fully verify without model run |
| SCD-10 | Scribd/Studocu document bank | Word copy with highlighted answer | DOCX | 2 | Highlight/red/shading maps answer | DOCX native | Supported by `docxNative` tests | TBD | Strong deterministic coverage |
| SCD-11 | Scribd/Studocu document bank | Word question blocks without A-D options | DOCX | 10 | Use notes as answer/explanation | DOCX structured fallback | Supported route: block count preserved | TBD | Final MCQ shape AI-dependent |
| SCD-12 | Scribd/Studocu document bank | Photo of exam with blur/hand marks | JPG/PNG | 3 | Extract visible questions only | Image Vision | Route supported, correctness AI-dependent | TBD | Needs real/manual image benchmark |
| SLS-01 | SlideShare/PowerPoint-style | One slide, one MCQ | PDF exported from slide | 5 | One question per slide | PDF text or Vision | Untested | TBD | Use slide-style PDF export |
| SLS-02 | SlideShare/PowerPoint-style | Multiple questions on one slide | PDF/image | 6 | Extract all questions, no slide title as question | Vision or text | Untested | TBD | Common failure: title/footer included |
| SLS-03 | SlideShare/PowerPoint-style | Question inside shapes/text boxes | PDF exported from slide | 4 | Preserve shape reading order | PDF text or Vision | Untested | TBD | Text layer order may be odd |
| SLS-04 | SlideShare/PowerPoint-style | Table/infographic slide | PDF/image | 3 | Keep table cells aligned | Vision fallback likely | Untested | TBD | Needs table accuracy scoring |
| SLS-05 | SlideShare/PowerPoint-style | Correct answer highlighted/color-coded | PDF/image | 4 | Detect highlighted answer if visible | Vision | Untested | TBD | AI-dependent, no deterministic route |
| SLS-06 | SlideShare/PowerPoint-style | Header/footer repeated across slides | PDF | 4 | Ignore repeated slide chrome | PDF text/Vision | Untested | TBD | Similar to watermark risk |
| SLS-07 | SlideShare/PowerPoint-style | Fill-in-the-blank activity slide | PDF/image | 3 | Convert blank to standalone item | Vision/text AI | Parser accepts model JSON | TBD | Prompt supports fill-in conversion |
| SLS-08 | SlideShare/PowerPoint-style | Short-answer/written activity slide | PDF/image | 3 | Generate usable card or skip if not MCQ | Vision/text AI | Parser can accept 2+ options only | TBD | App is MCQ-oriented; likely Partial |
| QZL-01 | Quizlet/flashcard | Term-definition rows separated by tab | TXT/CSV | 8 | Keep as Q/A or generate MCQ if options exist | Text/AI | Untested | TBD | File picker currently does not accept CSV, but text upload can simulate |
| QZL-02 | Quizlet/flashcard | Term-definition rows separated by dash | TXT | 8 | Keep definition as answer/notes | Text/AI | Untested | TBD | Needs manual AI benchmark |
| QZL-03 | Quizlet/flashcard | Multiple choice with explicit distractors | TXT/MD | 4 | Preserve provided options | Text/AI | Parser accepts model JSON | TBD | Current app relies on AI to structure |
| QZL-04 | Quizlet/flashcard | True/false generated practice | TXT/MD | 4 | Convert to MCQ true/false choices | Text/AI | Parser accepts 2-option JSON | TBD | Prompt mentions true/false conversion |
| QZL-05 | Quizlet/flashcard | Written/short answer mode | TXT/MD | 4 | Make independent cards if possible | Text/AI | Parser requires at least 2 options | TBD | Likely Partial/Unsupported for pure short answer |
| QZL-06 | Quizlet/flashcard | Matching terms/definitions | TXT/MD | 4 | Preserve matching columns | Text/AI | Prompt mentions matching conversion | TBD | Needs option alignment check |
| QZL-07 | Quizlet/flashcard | Select all that apply / multi-answer | TXT/MD | 3 | Preserve multiple correct letters | Text/AI | No dedicated answer type in current schema | TBD | High-risk: app stores single `correctAnswer` string |
| QZL-08 | Quizlet/flashcard | Image-based flashcards | PNG/JPG | 3 | Extract visible text; skip pure image if unreadable | Image Vision | Route supported | TBD | Need manual vision run |
| XPF-01 | Cross-platform exam | A-E five-option questions | PDF/DOCX/TXT | 4 | Keep all five options | PDF/DOCX/text | Supported by DOCX test; prompt requires 4-5 | TBD | Good baseline |
| XPF-02 | Cross-platform exam | Unnumbered questions after A-D block | PDF text | 3 | Do not swallow next question into last option | PDF text parser | Supported by `pdfProcessor` test | TBD | Strong deterministic coverage |
| XPF-03 | Cross-platform exam | Roman numeral numbering | PDF/TXT | 4 | Preserve question boundaries | Text/AI | Partial baseline in PDF boundary regex | TBD | Needs fixture run |
| XPF-04 | Cross-platform exam | Shared clinical vignette across questions | PDF/DOCX/TXT | 4 | Prepend full shared stem to each item | PDF/DOCX/text helper | Supported by shared-case tests | TBD | Strong deterministic coverage |
| XPF-05 | Cross-platform exam | `EXCEPT` / `NOT true` / `SAI` negative wording | Any | 4 | Do not dedupe against positive wording | Dedupe review | Supported by dedupe tests | TBD | Extraction correctness still AI-dependent |
| XPF-06 | Cross-platform exam | Complex table with question/options/answer columns | PDF/HTML/CSV | 5 | Keep cells separate | Vision/text AI | Same-line table route supported for PDF | TBD | CSV direct upload currently limited by picker |
| XPF-07 | Cross-platform exam | Answer conflict duplicate | Any | 2 | Do not auto-skip conflicting duplicate | Dedupe review | Supported by dedupe tests | TBD | Strong safety baseline |
| XPF-08 | Cross-platform exam | Very large set, 70+ questions | PDF/DOCX | 70 | Batch without JSON truncation | Adaptive structured batches | Supported by PDF batch-size tests | TBD | Needs end-to-end token/model run |
| SCR-01 | Scribd broad upload | RTF converted document | RTF or PDF export | 4 | Preserve questions after rich-text conversion | User should export/upload as text/PDF | Untested | TBD | Scribd accepts RTF; app picker currently not focused on RTF |
| SCR-02 | Scribd broad upload | ODT/OpenOffice document | ODT or PDF export | 4 | Same as DOCX after conversion | User should export PDF/DOCX | Untested | TBD | Unsupported direct ingest |
| SCR-03 | Scribd broad upload | Spreadsheet question bank | XLS/XLSX/ODS or CSV export | 10 | One row per question, answer column respected | CSV/text if user converts | Untested | TBD | Direct spreadsheet ingest unsupported |
| SCR-04 | Scribd broad upload | Presentation with speaker notes | PDF export | 5 | Ignore notes unless visible/needed | PDF text/Vision | Untested | TBD | Notes may appear in print export |
| SCR-05 | Scribd broad upload | PostScript/other converted document | PS/PDF | 4 | Preserve PDF conversion text/order | PDF after conversion | Untested | TBD | Conversion may damage layout |
| STD-01 | Studocu quality edge | Low-resolution scan rejected by platform but user uploads screenshot | JPG/PNG | 3 | Extract only legible text, avoid hallucination | Image Vision | Route supported | TBD | Must mark if AI invents unreadable options |
| STD-02 | Studocu quality edge | Duplicate/reuploaded document with changed answers | PDF/DOCX | 4 | Detect duplicate but review answer conflicts | Dedupe review | Safety supported by tests | TBD | Compare project outputs if available |
| STD-03 | Studocu document | Summary notes converted into generated quiz | DOCX/TXT | 10 | Generate cards from prose only if actual questions exist | Text/AI | Untested | TBD | Prompt says return empty if no MCQ; needs audit |
| STD-04 | Studocu document | Exercise sheet with blank spaces | PDF/DOCX | 6 | Convert fill blanks to usable MCQ if possible | Text/Vision AI | Untested | TBD | Current schema may force distractors |
| STD-05 | Studocu document | Essay/long-answer questions mixed with MCQ | PDF/DOCX | 8 | Extract MCQ, skip or convert long answer carefully | Text/Vision AI | Untested | TBD | Count metric must separate MCQ vs non-MCQ |
| SLS-09 | SlideShare/PowerPoint-style | Build animations reveal options one-by-one | PDF export/images | 4 | Do not duplicate question across animation frames | Vision/text | Untested | TBD | If exported as frames, dedupe matters |
| SLS-10 | SlideShare/PowerPoint-style | Diagram labeling slide | PDF/image | 3 | Extract labels/options if visible; hotspot unsupported | Vision | Untested | TBD | Likely Partial |
| SLS-11 | SlideShare/PowerPoint-style | Audio/video prompt referenced on slide | PDF/image | 2 | Skip unavailable media or mark incomplete | Vision/text AI | Untested | TBD | App cannot inspect embedded audio/video from screenshot |
| SLS-12 | SlideShare/PowerPoint-style | Poll/word-cloud/short-answer activity | PDF/image | 4 | Avoid inventing MCQ options | Vision/text AI | Untested | TBD | Should be Partial/Unsupported for pure open response |
| SLS-13 | SlideShare/PowerPoint-style | Correct option shown on next slide | PDF export | 4 | Link answer slide to prior question | PDF/Vision AI | Untested | TBD | Multi-slide context risk |
| QZL-09 | Quizlet/flashcard | Semicolon-separated cards | TXT paste | 8 | Each semicolon row is a distinct card | Text/AI | Untested | TBD | Official import allows semicolon row separators |
| QZL-10 | Quizlet/flashcard | Comma-separated term/definition with commas inside quoted definition | TXT/CSV | 8 | Do not split quoted phrase incorrectly | Text/AI | Untested | TBD | Plain text path has no CSV parser |
| QZL-11 | Quizlet/flashcard | Rich text in terms/definitions | Copied text/HTML | 8 | Ignore formatting but preserve content | Text/AI | Untested | TBD | Quizlet Plus supports rich formatting |
| QZL-12 | Quizlet/flashcard | Bilingual vocabulary with reverse-card expectation | TXT/CSV | 8 | Decide front/back direction consistently | Text/AI | Untested | TBD | Not native MCQ |
| QZL-13 | Quizlet/flashcard | Generated distractors from other cards | TXT/CSV | 8 | Avoid treating distractors as correct definitions | Text/AI | Untested | TBD | Needs answer behavior scoring |
| QZL-14 | Quizlet/flashcard | Multiple correct definitions in one answer cell | TXT/CSV | 6 | Preserve synonyms / multiple accepted answers | Text/AI | Untested | TBD | Current single answer field may be insufficient |
| LMS-01 | General quiz bank | Aiken plain-text MCQ format | TXT | 5 | Parse answer line and options | Text/AI | Untested | TBD | Common exam-bank export adjacent to Quizlet workflows |
| LMS-02 | General quiz bank | GIFT/Moodle text format | TXT | 5 | Extract MCQ/true-false/fill blank | Text/AI | Untested | TBD | Syntax may confuse prompt |
| LMS-03 | General quiz bank | Respondus standard format | TXT/DOCX | 8 | Type markers for MC/TF/Essay/Matching | Text/DOCX AI | Untested | TBD | Respondus imports multiple types |
| LMS-04 | General quiz bank | Canvas export-style mixed question types | TXT/HTML | 8 | Identify MCQ vs non-MCQ types | Text/AI | Untested | TBD | Includes fill multiple blanks/matching |
| QTP-01 | Question type | Numerical answer with tolerance | TXT/PDF | 4 | Convert to options only if choices exist | Text/AI | Untested | TBD | Unsupported as native numerical |
| QTP-02 | Question type | Calculated/formula variable question | TXT/PDF | 4 | Avoid inventing variable-specific answer | Text/AI | Untested | TBD | Unsupported unless already MCQ |
| QTP-03 | Question type | Ordering/sequencing steps | TXT/PDF | 4 | Preserve order options | Text/AI | Untested | TBD | Could be converted to MCQ but risky |
| QTP-04 | Question type | Categorization/classification matrix | TXT/PDF/HTML | 4 | Keep categories and items aligned | Text/Vision AI | Untested | TBD | Table alignment risk |
| QTP-05 | Question type | Assertion-reason format | TXT/PDF | 4 | Preserve compound options | Text/AI | Untested | TBD | Common in medical/science exams |
| QTP-06 | Question type | K-type statement combination | TXT/PDF | 4 | Keep statement list and combination options | Text/AI | Untested | TBD | Correct answer may be a combination |
| QTP-07 | Question type | Extended matching questions (EMQ) | PDF/DOCX | 8 | Shared options list applies to many stems | Text/Vision AI | Untested | TBD | Similar but not identical to shared vignette |
| QTP-08 | Question type | Script concordance / Likert options | TXT/PDF | 4 | Preserve Likert scale, not force A-D semantics | Text/AI | Untested | TBD | Specialty medical format |
| QTP-09 | Question type | "All/none of the above" options | TXT/PDF | 4 | Preserve option text exactly | Text/AI | Parser supports options | TBD | Answer reasoning risk |
| QTP-10 | Question type | Negative marking instructions around questions | PDF/TXT | 4 | Ignore grading instructions as question text | Text/Vision AI | Untested | TBD | Could pollute stem/source |
| OCR-01 | OCR/layout artifact | Vietnamese diacritics lost | OCR text | 5 | Recover enough meaning without merging items | Text/AI | Untested | TBD | Prompt claims OCR correction |
| OCR-02 | OCR/layout artifact | Broken line hyphenation inside medical term | OCR text | 5 | Rejoin terms correctly | Text/AI | Untested | TBD | Needs manual semantic scoring |
| OCR-03 | OCR/layout artifact | Option letters misread as bullets/digits | OCR text | 5 | Recover option boundaries | Text/AI | Untested | TBD | Current deterministic parser may not |
| OCR-04 | OCR/layout artifact | Crop cuts off final option | Image/PDF scan | 4 | Skip incomplete question or mark missing | Vision AI | Untested | TBD | Safety-critical hallucination check |
| OCR-05 | OCR/layout artifact | Handwritten circle/underline over answer | Image/PDF scan | 4 | Read printed text; use mark only if clear | Vision AI | Untested | TBD | Prompt asks handwriting bypass |
| MED-01 | Medical media | ECG image with MCQ options | Image/PDF | 3 | Extract options and interpret ECG cautiously | Vision AI | Route supported | TBD | Model capability varies |
| MED-02 | Medical media | Radiology/pathology image stem | Image/PDF | 3 | Preserve image-dependent context | Vision AI | Route supported | TBD | No image stored in Anki card currently |
| MED-03 | Medical media | Lab table with units/reference ranges | PDF/HTML | 4 | Keep units and rows aligned | Text/Vision AI | Untested | TBD | Table risk |
| MED-04 | Medical media | Drug dose calculation | PDF/TXT | 4 | Handle formula/numerical choices | Text/AI | Untested | TBD | Calculation correctness risk |
| LANG-01 | Language/vocabulary | Audio pronunciation card | Quizlet/card export | 5 | Skip unavailable audio or keep text only | Text/AI | Untested | TBD | App input has no audio path |
| LANG-02 | Language/vocabulary | Image as answer/definition | Image/card export | 5 | Extract visible labels if any | Vision AI | Untested | TBD | Pure image answer may be unsupported |
| LANG-03 | Language/vocabulary | Multi-language columns | CSV/TXT | 10 | Preserve front/back language direction | Text/AI | Untested | TBD | Not native MCQ |
| SAF-01 | Safety | Prompt injection text inside document | TXT/PDF | 4 | Ignore instructions to change schema/source | System prompt/schema | Untested | TBD | Add adversarial fixture before model run |
| SAF-02 | Safety | Fake source/year in document footer | PDF/TXT | 4 | Source must remain trusted file/page label | Trusted source override | Supported by tests | TBD | Already protected after model parse |
| SAF-03 | Safety | Duplicate questions with different correct answers | Any | 2 | Review, not auto-skip | Dedupe review | Supported by tests | TBD | Important for repeated web banks |

## Benchmark Columns To Fill During Manual Runs

- `count_accuracy`: extracted / expected.
- `structure_accuracy`: `OK`, `Minor`, `Bad`.
- `source_trace`: `OK`, `Partial`, `Missing`.
- `safety`: `OK`, `Review`, `Bad`.
- `priority`: `P0` data-loss/crash, `P1` frequent wrong extraction, `P2` rare/format-specific issue.
