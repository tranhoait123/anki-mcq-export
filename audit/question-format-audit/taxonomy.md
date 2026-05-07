# Extended Question/Input Taxonomy

This file expands the audit beyond the first-pass matrix. It is a checklist of cases that can appear when users bring study material from Scribd, Studocu, SlideShare, Quizlet, or adjacent quiz/document systems.

## Platform And File Container Cases

| Group | Cases To Audit | Why It Matters For This App |
|---|---|---|
| Scribd document uploads | PDF, TXT, RTF, ODT/SXW, DOC/DOCX, PS, OpenDocument drawing/formula files | Scribd accepts broad document families; the app currently focuses on PDF/DOCX/images/text. |
| Scribd presentation uploads | PPT/PPTX/PPS/PPSX/KEY/ODP/SXI converted to web/PDF-like previews | Slide reading order, shapes, speaker notes, and exported PDFs may differ from original slides. |
| Scribd spreadsheet uploads | XLS/XLSX/ODS/SXC question banks | Questions may be rows/cells, not prose; options and answers often sit in columns. |
| Studocu documents | PDF/DOC/DOCX lecture notes, exercises, summaries, exam prep | Studocu official guidance highlights PDF/DOC/DOCX and warns about scans/low-res files. |
| SlideShare uploads | PPT/PPTX/PPSX/POTX, PDF, DOC/DOCX | Users may export slide decks to PDF/images before app upload. |
| Quizlet imports | Copied text from docs/spreadsheets, term-definition delimiter rows | App sees this as plain text today; the audit should check if AI converts it safely. |
| User screenshots | Browser screenshots, mobile photos, cropped page previews | Common when source is not downloadable; depends entirely on Vision quality. |
| User exports | PDF print-to-file, browser print, pasted text, OCR text, copied HTML tables | Conversion can reorder columns, remove answer highlighting, or duplicate headers. |

## Layout And Visual Cases

| Group | Cases |
|---|---|
| Page layout | single column, two columns, three columns, newspaper layout, landscape page, booklet scan, page split across images |
| Slide layout | one question per slide, multiple questions per slide, title + question, speaker notes, footer/header repeats, slide number as false question |
| Table layout | one row per question, options as columns, answers as final column, merged cells, wrapped cells, vertical text, multi-row stem |
| Option layout | A-D each line, A-E, A-F or more, same-line options, bullets instead of letters, numbered options, checkbox symbols, circled letters |
| Answer marks | highlighted answer, red answer, bold/underline answer, checkmark, star, circled/khoanh đáp án, answer key at end, answer key per page |
| OCR artifacts | broken Vietnamese diacritics, `Câu` read as `Cau/Gau`, A/B/C/D confused with bullets, missing punctuation, hyphenated line breaks |
| Noise | watermark, blurred preview overlay, page footer, uploader name, ad text, repeated logo, handwritten notes, underlines, strike-through |
| Image quality | low-res, skew, perspective distortion, shadow, crop cutting options, finger/pen obstruction, dark mode screenshot |
| Math/science | formulas, sub/superscript, units, Greek letters, chemical notation, tables/graphs/ECG/image-based stems |

## Question-Type Cases

| Type | Cases |
|---|---|
| Single-best-answer MCQ | A-D/A-E/A-F, with/without answer, with explanation, stem-first or option-first |
| Multiple-response | select all that apply, more than one correct answer, partial-credit style, "which are true" grouped statements |
| True/False | one statement, multiple statements true/false, T/F table, đúng/sai columns |
| Matching | two columns, many-to-one matching, extended matching questions, drag/drop matching expressed as text |
| Fill blank / Cloze | single blank, multiple blanks, dropdown blanks, embedded MCQ inside paragraph |
| Short answer / Written | exact phrase, synonym answers, spelling variants, language vocabulary cards |
| Numerical / Calculated | number answer, unit-sensitive answer, tolerance/range, formula-generated values |
| Ordering / Sequencing | arrange steps, chronological order, process flow, ranking |
| Classification / Categorization | place items into categories, matrix classification, "belongs/does not belong" |
| Hotspot / Image-based | identify region on image, label diagram, ECG/radiology/pathology image question |
| Case/vignette set | shared case before questions, case split across pages, case after questions, long stem reused |
| Negative wording | NOT, EXCEPT, FALSE, SAI, KHÔNG, contraindication/avoid wording |
| Assertion-reason | "Assertion (A) and Reason (R)" options, both true but reason relationship varies |
| K-type / statement-combination | options like "1,2,3 only", "A and C", "all of the above", "none of the above" |
| Flashcard term-definition | term as front, definition as back, reverse card, image/audio definition, generated MCQ distractors |

## Answer-Key Cases

| Group | Cases |
|---|---|
| Inline answers | answer directly after options, marked option, explanation states answer |
| Separate answer key | at end of file, after every page, in separate file, compact sequence like `1B 2A 3C` |
| Ambiguous key | answer number mismatch, duplicate numbering, missing answers, revised answer key, answer conflicts with marked option |
| No key | AI must infer; benchmark should separate "extraction works" from "answer correctness". |
| Multiple correct | comma-separated letters, "A and D", checkbox marks, explanation lists several correct items |

## Language And Domain Cases

| Group | Cases |
|---|---|
| Language | Vietnamese with/without accents, English, mixed Vietnamese-English, abbreviations, OCR-lost accents |
| Medical domain | clinical vignette, lab values, imaging, ECG, pathology, drug dose, guideline criteria |
| Non-medical domain | law, English vocabulary, IT, math, accounting, anatomy diagrams, public-health tables |
| Translation style | term-definition vocabulary, bilingual columns, one language in stem and another in options |

## Current-App Risk Buckets

| Risk | Examples | Audit Interpretation |
|---|---|---|
| Ingest unsupported | PPTX/XLSX/ODT directly | Mark unsupported unless user exports to app-supported file. |
| Vision-dependent | scan, screenshot, highlighted slide answers, handwritten marks | Run only with the same vision model/settings and record model variance. |
| Text-parser risky | same-line options, multi-column PDF, broken table text | Verify whether Safe Hybrid correctly routes to Vision. |
| Schema mismatch | multi-answer, short answer, numerical, hotspot, ordering | App can maybe convert to MCQ, but output may be partial because current schema is MCQ-centered. |
| Safety risky | negative wording, duplicate shared stems, conflicting answer keys | Must check no unsafe auto-skip or answer flip. |

