# 🧠 AnkiGen Pro - Medical MCQ Extractor

> **Automated tool for generating Anki cards from Medical documents (PDF/Images) using AI & OCR power.**
> *Developed by [Tran Hoa](https://github.com/tranhoait123)*

[ [🇻🇳 Tiếng Việt](README.md) | **🇺🇸 English** ]

**AnkiGen Pro** is a personal project built to solve the challenge of extracting Multiple Choice Questions (MCQs) from low-quality scans, curved/blurred images, or documents with heavy handwriting notes. The system leverages **Google Gemini AI** models combined with **Local OCR (Tesseract)** to ensure absolute accuracy.

![AnkiGen Pro Demo](https://placehold.co/1200x600/6366f1/ffffff?text=AnkiGen+Pro+Preview)

## ✨ Key Features

-   **🤖 Smart Auto Mode**: Automatically detects and switches between Cloud AI (fast, intelligent) and Local OCR (robust with blurry images) to ensure 100% question extraction.
-   **🩺 Medical Professor Persona**: The AI is fine-tuned to act as a "Senior Medical Professor", providing not just answers but deep explanations of pathophysiology, differential diagnosis, and clinical pitfalls.
-   **📝 Multi-Format Support**: Handles complex question types perfectly: Matching columns, True/False, and Multi-select questions.
-   **🧹 Noise Reduction**: Automatically ignores handwriting, circled answers, red/blue ink marks that cause interference.
-   **🎨 Beautiful Anki Cards**: Exports to CSV with pre-styled HTML ready for Anki, featuring a professional, easy-to-learn card interface.

## 🚀 Installation Guide

Follow these simple steps to run the tool on your machine.

### 1. System Requirements
-   **Node.js** (Version 18 or higher). [Download here](https://nodejs.org/).
-   **Git**.

### 2. Download Source Code
Open your Terminal and run:

```bash
git clone https://github.com/tranhoait123/anki-mcq-export.git
cd anki-mcq-export
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure API Key
Create a `.env.local` file in the root directory of the project and paste your Google Gemini API Key (get it at [aistudio.google.com](https://aistudio.google.com/)).

```env
VITE_GEMINI_API_KEY=AIzaSy...YourKey,AIzaSy...BackupKey
```
*Tip: You can enter multiple keys separated by commas `,` to enable automatic key rotation if quota is exceeded.*

### 5. Run the App
```bash
npm run dev
```
Access `http://localhost:5173` to start using it!

## 📖 Usage Guide

1.  **Upload**: Drag & drop exam images or PDFs.
2.  **Scan**: Click "Scan Document" for the system to count questions and identify the topic.
3.  **Extract**: Click the extract button. The system will automatically clean data and generate questions.
4.  **Review**: Check the extracted questions and read the detailed explanations.
5.  **Export Anki**: Click "Download Anki CSV" and import it into your deck.

---
*Open source project serving the Medical Student community.*
