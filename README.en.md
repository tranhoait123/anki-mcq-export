# 🧠 MCQ AnkiGen Pro — From Documents to Anki Cards in Minutes

> **Turn any medical document (blurry scans, quick photos, heavy PDFs) into high-quality Anki flipcards in minutes.**
> *Developed by [PonZ](https://github.com/tranhoait123)*

---

[ [🇻🇳 Tiếng Việt](README.md) | [🇺🇸 English](README.en.md) ]

## 📑 Table of Contents

1. [Introduction](#-introduction)
2. [⚡ Use Online — No Installation Required](#-use-online--no-installation-required)
3. [🎬 Video Tutorial & Sample Files](#-video-tutorial--sample-files)
4. [🔑 Get Google Gemini API Key (Free)](#-get-google-gemini-api-key-free)
5. [🌐 Detailed User Guide](#-detailed-user-guide)
6. [📲 Import CSV into Anki](#-import-csv-into-anki)
7. [💻 Local Installation (Optional)](#-local-installation-optional)
8. [🐍 Streamlit Version (Python)](#-streamlit-version-python)
9. [🎯 Advanced Tips & Troubleshooting](#-advanced-tips--troubleshooting)
10. [❓ Frequently Asked Questions (FAQ)](#-frequently-asked-questions-faq)

---

## 🧠 Introduction

**MCQ AnkiGen Pro** is an open-source tool that helps you:

| Feature | Description |
|:---|:---|
| 🤖 **AI MCQ Extraction** | Uses Google Gemini AI to "read" scanned documents, photos, PDFs and extract multiple-choice questions. |
| 🩺 **Professor-level Explanations** | Every question includes: core answer, deep analysis, medical evidence, and clinical warnings. |
| 💾 **Anki-ready CSV Export** | Generates a CSV file ready to be imported into Anki — no additional editing needed. |
| 🔄 **Smart Deduplication** | Automatically detects and manages duplicate questions when processing multiple tests. |
| 🌙 **Dark Mode & Split View** | Easy on the eyes for night studying, view original documents and extracted results side-by-side. |

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
| ✅ **Fully Featured** | Dark Mode, Split View, Editing, Filtering, CSV Export |
| ✅ **Cross-device** | PC, Mac, phone, tablet — just needs a browser |
| ✅ **Secure Data** | All processing happens in your browser, nothing is saved to a server |

> 💡 **On Mobile:** You can "Add to Home Screen" to use it as a native app!

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
| **Google Gemini API Key** | Paste the API Key you generated. *Can input multiple keys separated by commas.* |
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

### Step 5: Export CSV

When satisfied:

| Button | Function |
|:---|:---|
| **📋 Copy CSV** | Copy everything to clipboard — directly paste to Excel/Sheets |
| **📥 Export CSV** | Download `.csv` file, ready for Anki |

CSV Format:
```text
Question | A | B | C | D | E | CorrectAnswer | ExplanationHTML | Source | Difficulty
```

> The CSV is **UTF-8 BOM** formatted to ensure Vietnamese/Foreign characters display properly anywhere.

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
2. Add a new Note type with fields: `Question`, `A`, `B`, `C`, `D`, `E`, `CorrectAnswer`, `ExplanationHTML`, `Source`, `Difficulty`.

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

## 🐍 Streamlit Version (Python)

A simpler alternative dashboard.

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Runs on **http://localhost:8501**.

---

## ❓ Frequently Asked Questions (FAQ)

### 🗨️ "Is this app free?"
**Yes, entirely free.** Open source on GitHub. You only need a free Google Gemini API Key.

### 🗨️ "Is my data sent anywhere?"
Documents are sent to **Google Gemini API** for OCR/inference. The app **does not store your data on any server** — processing is strictly between your browser and Google API.

### 🗨️ "Can I use it for other subjects like IT or Law?"
**Yes!** In Settings, change the AI Persona to Law, IT, English, etc.

---

## 📜 Changelog

| Version | Date | Highlights |
| :--- | :--- | :--- |
| **v5.0 (Atomic)** | 04/04/2026 | **Zustand Architecture, Sonner Toasts, Review-First UI, Enhanced Markdown Tables** |
| **v4.7 (Gemini)** | 03/28/2026 | Added **Gemini 3.1 Flash-Lite** as default, **Gemini 2.5 Flash** fallback |
| **v4.6 (Native)** | 02/04/2026 | **Native PDF Engine**, Overlap Scanning |
| **v4.0 (Pro)** | 02/04/2026 | **50MB Limit**, IndexedDB Storage, Premium UI |

---

*Open source project serving the Medical Student community.*  
**Developed by [PonZ](https://github.com/tranhoait123)** 🩺
