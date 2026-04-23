# 🧠 MCQ AnkiGen Pro — From Documents to Anki Cards in Minutes

> **Turn any medical document (blurry scans, quick photos, heavy PDFs) into high-quality Anki flipcards in minutes.**
> *Developed by [PonZ](https://github.com/tranhoait123)*

---

[ [🇻🇳 Tiếng Việt](README.md) | [🇺🇸 English](README.en.md) ]

## 📑 Table of Contents

1. [Introduction](#-introduction)
2. [⚡ Use Online — No Installation Required](#-use-online--no-installation-required)
3. [🧩 Key Features](#-key-features)
4. [📥 Supported Formats](#-supported-formats)
5. [🎬 Video Tutorial & Sample Files](#-video-tutorial--sample-files)
6. [🔑 Get Google Gemini API Key (Free)](#-get-google-gemini-api-key-free)
7. [🌐 Detailed User Guide](#-detailed-user-guide)
8. [📤 Export Files](#-export-files)
9. [📲 Import CSV into Anki](#-import-csv-into-anki)
10. [💻 Local Installation (Optional)](#-local-installation-optional)
11. [🐍 Streamlit Version (Python)](#-streamlit-version-python)
12. [🧪 Tests & Build](#-tests--build)
13. [🎯 Advanced Tips & Troubleshooting](#-advanced-tips--troubleshooting)
14. [❓ Frequently Asked Questions (FAQ)](#-frequently-asked-questions-faq)

---

## 🧠 Introduction

**MCQ AnkiGen Pro** is an open-source tool that helps you:

| Feature | Description |
|:---|:---|
| 🤖 **AI MCQ Extraction** | Uses Google Gemini AI to "read" scanned documents, photos, PDFs and extract multiple-choice questions. |
| 🩺 **Professor-level Explanations** | Every question includes: core answer, deep analysis, medical evidence, and clinical warnings. |
| 💾 **Anki-ready CSV/DOCX Export** | Generates Anki-ready CSV and study DOCX files — no additional editing needed. |
| 🔄 **Smart Deduplication** | Automatically detects and manages duplicate questions when processing multiple tests. |
| 🌙 **Dark Mode & Split View** | Easy on the eyes for night studying, view original documents and extracted results side-by-side. |

### Overall Flow

```text
Source document → scan/estimate → extract MCQs → dedupe → edit/review → export CSV/DOCX → study or import into Anki
```

**3 ways to use it:**

1. **⚡ Access Online** — The fastest way, zero setup *(recommended)*
2. **💻 Local Install (Node.js)** — Run offline, full control
3. **🐍 Streamlit App (Python)** — Simpler interface, fast processing via Python

---

## ⚡ Use Online — No Installation Required

> **This is the easiest way to start** — all you need is a web browser and an API Key!

### 👉 Access now: [mcqankigen.drponz.com](https://mcqankigen.drponz.com/)

The app is deployed online. You can use it **instantly** on any device (PC, Mac, mobile, tablet) **without installing anything**.

### 3 Simple Steps:

```text
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │   Step 1 ─ Open https://mcqankigen.drponz.com/               │
 │   Step 2 ─ Get a free API Key (see guide below)              │
 │   Step 3 ─ Upload file → Scan → Extract → Export CSV!        │
 │                                                              │
 └──────────────────────────────────────────────────────────────┘
```

| Benefits | Details |
|:---|:---|
| ✅ **No Installation** | Open the link and use it instantly |
| ✅ **100% Free** | Only requires a Google API Key (free) |
| ✅ **Fully Featured** | Dark Mode, Split View, Editing, Filtering, CSV/DOCX Export |
| ✅ **Cross-device** | PC, Mac, phone, tablet — just needs a browser |
| ✅ **Secure Data** | All processing happens in your browser, nothing is saved to a server |

> 💡 **On Mobile:** You can "Add to Home Screen" to use it as a native app!

---

## 🧩 Key Features

| Area | Details |
|:---|:---|
| **Flexible AI Engine** | Supports Google Gemini, OpenRouter, Vertex AI, and ShopAIKey. The app coerces incompatible model choices before runtime. |
| **PDF/Image Handling** | PDFs are split into overlapping chunks; providers that do not accept raw PDFs can receive rasterized page images. |
| **DOCX Native + Smart Fallback** | Real-text Word files are parsed from `word/document.xml`; yellow highlights are preserved as correct answers; scanned Word files are flagged for PDF/image Vision mode. |
| **Fast Mode** | Skip the initial analysis step when you already know the file and want faster extraction. |
| **Rich Explanations** | Each card can include core answer, evidence, deep analysis, warning, source, difficulty, and reasoning key point. |
| **Duplicate Review** | Suspected duplicates are reviewed instead of silently deleted; keep both, skip, or replace. |
| **Dual Export** | Export Anki CSV or a readable DOCX study document with tables and metadata. |
| **Local Persistence** | MCQs, settings, and cache data are stored locally with IndexedDB/localStorage. |

---

## 📥 Supported Formats

### Input

| Format | Notes |
|:---|:---|
| **PDF** | Good for scans or long documents; the app chunks PDFs automatically. |
| **Images** | PNG, JPG, JPEG, WebP, HEIC. Use straight, well-lit images. |
| **Word** | DOCX. Real-text Word uses native parsing; scanned Word should be exported to PDF/image for Vision. |
| **Text/Markdown** | TXT, MD. |
| **CSV** | Can be re-imported for dedupe, editing, or re-export. |

### Output

| Format | Use |
|:---|:---|
| **Anki CSV** | Import into Anki with the `3MCQ` note type; supports HTML explanations. |
| **DOCX Study Export** | Read, print, or share a study document with questions, answers, explanations, tables, and metadata. |
| **Copy CSV** | Paste quickly into Excel, Google Sheets, or other tools. |

---

## 🎬 Video Tutorial & Sample Files

### Video Demo

Watch the demo covering the entire workflow from uploading → extracting → exporting CSV → importing to Anki:

> 📹 The video file is available in the repo: [`Hướng dẫn sử dụng.mov`](./Hướng%20dẫn%20sử%20dụng.mov)

### 📦 Sample Files — See The Results Instantly

Want to see what the final Anki cards look like before you start? Import the demo into Anki:

| File | Description | Download |
|:---|:---|:---|
| **DEMO.apkg** | 🎉 Sample deck already extracted — view the actual results | [📥 Download DEMO.apkg](./DEMO.apkg) |
| **3MCQ.apkg** | 📋 "3MCQ" Note Type optimized for the app — use when importing CSV | [📥 Download 3MCQ.apkg](./3MCQ.apkg) |

> 💡 Open Anki → **File → Import** → select `DEMO.apkg` to instantly see sample multiple-choice flashcards complete with questions, answers, and detailed explanations!

---

## 🔑 Get Google Gemini API Key (Free)

The API Key is the "key" for the app to communicate with Google's AI. It is **completely free** for personal use limits.

### Steps:

**Step 1:** Visit [Google AI Studio](https://aistudio.google.com/app/apikey)

**Step 2:** Log in with your Google account

**Step 3:** Click **"Create API Key"**

**Step 4:** Select a Google Cloud project (or let it default), then click **"Create"**

**Step 5:** Copy the displayed API Key (starts with `AIzaSy...`) — keep it safe!

> ⚠️ **API Key Security:** Do not share your Key with others.

### 🔥 Tip: Create Multiple Keys to Bypass Quotas

Each API Key belongs to a **Google Cloud Project**, and each Project has its own **free quote**. By creating keys across multiple projects, you can **multiply** your free tier limit!

#### How to create multiple keys:

**Step 1:** Go to [Google AI Studio → API Keys](https://aistudio.google.com/app/apikey)

**Step 2:** Click **"Create API Key"**

**Step 3:** Under **"Google Cloud Project"**, click **"Create new project"** instead of choosing an existing one.

**Step 4:** Name it (e.g. `anki-key-2`) → Click **"Create"**

**Step 5:** Repeat steps 2-4 for multiple projects.

#### Specifying multiple keys in the app:

Go to **⚙️ Settings → Google Gemini API Key**, paste all keys separated by a **comma** `,`:

```text
AIzaSyA...,AIzaSyB...,AIzaSyC...
```

The system will **automatically rotate** — if a key runs out of quota (429 Error), it shifts to the next one automatically seamlessly!

---

## 🌐 Detailed User Guide

> These steps apply to **both the online version** ([mcqankigen.drponz.com](https://mcqankigen.drponz.com/)) and the **local installation**.

### Step 1: Configure API Key & AI Model

1. Click the **⚙️ (Settings) icon** in the top right.
2. The **"System Settings"** modal will appear:

| Option | Guide |
|:---|:---|
| **AI Engine** | Choose Google Gemini, OpenRouter, Vertex AI, or ShopAIKey. New users should start with Google Gemini. |
| **Google Gemini API Key** | Paste the API Key you generated. *Can input multiple keys separated by commas.* |
| **OpenRouter / ShopAIKey API Key** | Use gateway providers when you want access to other model families. |
| **Vertex AI** | Enterprise path requiring GCP Project ID, Location, and OAuth Access Token. |
| **AI Model** | Choose an appropriate model. **Recommended: `Gemini 3.1 Flash-Lite`** — fastest and sharpest. |
| **AI Persona** | Select the domain: **Medical**, **English**, **Law**, **IT** — or write a custom prompt. |

3. Click **"Done"** to save.

---

### Step 2: Upload Documents

In the **Control Panel** (left side):

1. **Drag and drop** files into the upload zone, or click it.
2. Supported formats:
   - 📄 **PDF** (Max 50MB/file)
   - 🖼️ **Images** (PNG, JPG, JPEG, WebP, HEIC)
   - 📝 **Word** (DOCX)
   - 📋 **Text** (TXT, MD)
3. You can upload **multiple files** simultaneously.

> ⚠️ **For scanned/photographed exams**: For best results:
> - Take **straight, well-lit** non-blurry photos.
> - Ensure **fingers aren't blocking text**.

#### DOCX Processing Status

When uploading a Word file, the app automatically shows one of three states:

| Status | Meaning | Best action |
|:---|:---|:---|
| **DOCX native: N questions** | The app parsed Word XML directly, found MCQs, and preserved yellow highlights as correct answers. | Use it directly; this is the fastest and most accurate path. |
| **DOCX text fallback** | The file has text, but the A/B/C/D structure is not clear enough for native splitting. | Let the app scan the clean text fallback. |
| **Use PDF/Image** | The Word file has little or no real text, usually because it contains scanned images. | Export Word to PDF or clear page images and upload again for Vision mode. |

---

### Step 3: Scan & Extract Questions

A **two-phase** sequential process:

#### Phase 1 — Document Scan

1. Click **"🛰️ QUÉT TÀI LIỆU" (Scan Document)**
2. AI analyzes the document and provides:
   - **Topic** (e.g. "Pediatrics - Respiratory")
   - **Estimated Question Count** (e.g. 45 questions)
3. Wait for the system to read "Ready", then proceed to Phase 2.

#### Phase 2 — Extract Questions

1. Click **"✨ TRÍCH XUẤT CÂU HỎI" (Extract Questions)**
2. The system will:
   - Chunk PDFs into smaller overlapping parts (3 pages/part).
   - Scan in parallel for maximum speed.
   - Auto-filter duplicates.
3. The **Progress bar** updates the extracted count in real time.

---

### Step 4: View, Edit & Filter Results

Once extraction completes, results render on the **right panel**:

#### 工具 Toolbar

| Button | Function |
|:---|:---|
| **🔎 Search** | Filter by keywords |
| **📊 Difficulty** | Filter by Easy / Medium / Hard |
| **✏️ Edit / 👁️ Review** | Toggle between Edit Mode and Anki Preview |
| **⚠️ Warning** | Only show questions bearing clinical warnings |

#### ✏️ Editing Questions

- Hover over any question to reveal:
  - **🖊 Edit** 
  - **🗑 Delete**

#### 🔀 Split View Mode

Click the **📊 (Columns)** button in the Header to enable **Split View**:
- **Left**: Original document
- **Right**: Extracted questions

---

### Step 5: Export Files

When satisfied:

| Button | Function |
|:---|:---|
| **📋 Copy CSV** | Copy everything to clipboard — directly paste to Excel/Sheets |
| **📥 Export CSV** | Download `.csv` file, ready for Anki |
| **📄 Export DOCX** | Download a readable study `.docx` with questions, answers, explanations, tables, and metadata |

CSV Format:
```text
Question | A | B | C | D | E | CorrectAnswer | ExplanationHTML | Source
```

> The CSV is **UTF-8 BOM** formatted to ensure Vietnamese/Foreign characters display properly anywhere.

---

## 📤 Export Files

### CSV for Anki

The CSV export normalizes question/options, resolves the correct answer letter, escapes quotes safely, includes UTF-8 BOM, and packages explanations as Anki-friendly HTML.

### DOCX for Direct Study

DOCX export is useful for reading, printing, or sending a review copy before Anki import. It includes question text, options, correct answer marks, explanation sections, Markdown tables converted to Word tables, and source/difficulty/reasoning metadata.

---

## 📲 Import CSV into Anki

### Step 1: Open Anki Desktop

Download Anki at [apps.ankiweb.net](https://apps.ankiweb.net/).

### Step 2: Set up Note Type

#### ⚡ Fast Method: Using "3MCQ" Note Type (Recommended)

I have created an optimized Note Type named **"3MCQ"**. Simply:

1. 📥 Download [**3MCQ.apkg**](./3MCQ.apkg) from this repo.
2. Open Anki → **File → Import** → select `3MCQ.apkg`.
3. The "3MCQ" Note type is automatically added — **done!**

#### 🔧 Manual Method: Create custom Note Type
1. Go to **Tools → Manage Note Types → Add**
2. Add a new Note type with fields: `Question`, `A`, `B`, `C`, `D`, `E`, `CorrectAnswer`, `ExplanationHTML`, `Source`.

### Step 3: Import CSV

1. Go to **File → Import**
2. Select the exported CSV.
3. Setup:
   - **Type**: "3MCQ"
   - **Deck**: Choose a deck.
   - **Field separator**: Comma
   - **Allow HTML in fields**: ✅ **TURN ON** (crucial for beautiful explanations).
4. Click **Import**.

---

## 💻 Local Installation (Optional)

> 📝 Only if you want to run offline on a personal machine. If using the online version, skip this.

### Requirements
- **Node.js**: v18+
- **Git** (optional): To clone source code.

### Installation Steps

```bash
git clone https://github.com/tranhoait123/anki-mcq-export.git
cd anki-mcq-export
npm install
npm run dev
```

Open your browser at **http://localhost:5173**!

---

## 🧪 Tests & Build

Before deploying or making large changes, run:

```bash
npm test
npm run build
```

Current tests cover Anki HTML escaping/formatting, DOCX export, DOCX native parsing, dedupe, model registry, retry strategy, and provider request/error handling.

---

## 🐍 Streamlit Version (Python)

A simpler alternative dashboard.

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Runs on **http://localhost:8501**.

---

## 🎯 Advanced Tips & Troubleshooting

| Issue | Likely cause | Fix |
|:---|:---|:---|
| **Only a few questions extracted from DOCX** | Old HTML/text batching or unclear Word structure | Use the latest version; native DOCX mode splits MCQs before AI. |
| **DOCX text fallback** | Word has text but not clear question → A/B/C/D blocks | It can still scan; if missing questions, make each option a separate line or export to PDF/image. |
| **Use PDF/Image shown for DOCX** | Word contains scanned images instead of real text | Export the Word file to PDF or clear images, then upload again for Vision. |
| **PDF fails on a gateway provider** | Provider does not accept raw PDFs | The app rasterizes PDF pages for compatible Vision models. |
| **Quota/rate limit** | API key reached provider limits | Add multiple Google keys separated by commas or switch model/provider. |

---

## ❓ Frequently Asked Questions (FAQ)

### 🗨️ "Is this app free?"
**Yes, entirely free.** Open source on GitHub. You only need a free Google Gemini API Key.

### 🗨️ "Is my data sent anywhere?"
Documents are sent to **Google Gemini API** for OCR/inference. The app **does not store your data on any server** — processing is strictly between your browser and Google API.

### 🗨️ "Can I use it for other subjects like IT or Law?"
**Yes!** In Settings, change the AI Persona to Law, IT, English, etc.

### 🗨️ "Should I convert Word to PDF or images?"
Only when the app shows **Use PDF/Image** or the DOCX is a scanned-image document. If it shows **DOCX native: N questions**, keep native mode because it is faster, cheaper, and preserves yellow-highlighted answers.

### 🗨️ "What is the difference between CSV and DOCX export?"
**CSV** is for importing into Anki. **DOCX** is for direct reading, printing, or sharing a review copy.

---

## 📜 Changelog

| Version | Date | Highlights |
| :--- | :--- | :--- |
| **v5.5 (DOCX Native)** | 04/22/2026 | Native DOCX parser, yellow-highlight answer detection, 10-question batching, text fallback, and PDF/image warning for scanned Word files |
| **v5.4 (Export Polish)** | 04/22/2026 | DOCX Study Export, stable left alignment after tables, expanded documentation |
| **v5.0 (Atomic)** | 04/04/2026 | **Zustand Architecture, Sonner Toasts, Review-First UI, Enhanced Markdown Tables** |
| **v4.7 (Gemini)** | 03/28/2026 | Added **Gemini 3.1 Flash-Lite** as default, **Gemini 2.5 Flash** fallback |
| **v4.6 (Native)** | 02/04/2026 | **Native PDF Engine**, Overlap Scanning |
| **v4.0 (Pro)** | 02/04/2026 | **50MB Limit**, IndexedDB Storage, Premium UI |

---

*Open source project serving the Medical Student community.*  
**Developed by [PonZ](https://github.com/tranhoait123)** 🩺
