# 🚀 Gói Cập Nhật & Sửa Lỗi Toàn Diện 2026 (ShopAIKey & Stability Fix)

Tài liệu này tổng hợp các thay đổi quan trọng để ứng dụng chạy ổn định, không còn bị xung đột API Key khi dùng ShopAIKey và trích xuất chuẩn 100%.

---

## 🛑 1. Cô lập API Key & Xử lý song song (src/core/brain.ts)

### 1.1 Cô lập logic Google API Key (Fix triệt để lỗi "Đòi Google Key")

Đảm bảo `userKeyRotator.init` chỉ chạy khi nhà cung cấp là Google.

```typescript
// Trong hàm analyzeDocument, auditMissingQuestions
if (settings.provider === 'google') {
  userKeyRotator.init(settings.apiKey);
  return await executeWithUserRotation(async (apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    // ... logic Google ...
  });
}
```

### 1.2 Fix lỗi ShopAIKey gọi nhầm sang OpenRouter

Đảm bảo khi dùng các model như Claude/GPT qua ShopAIKey, mã nguồn trỏ đúng về `api.shopaikey.com`.

```typescript
} else if (settings.provider === 'shopaikey') {
  if (!settings.shopAIKeyKey) throw new Error("Vui lòng nhập ShopAIKey API Key.");
  
  const response = await fetch("https://api.shopaikey.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.shopAIKeyKey}`,
      "Content-Type": "application/json"
    },
    // ... logic gửi content ...
  });
}
```

### 1.3 Tăng tốc xử lý (Concurrency = 5)

```typescript
const CONCURRENCY_LIMIT = 5;
```

---

## 📄 2. Chốt chặn UI và Xuất CSV Siêu bền bỉ (src/App.tsx)

### 2.1 Kiểm tra Key ngay tại UI (Handle Generate/Analyze)

Báo lỗi ngay nếu người dùng chưa nhập Key cho nhà cung cấp đã chọn.

```typescript
const handleGenerate = async () => {
    if (files.length === 0) return;
    setLoading(true);

    if (settings.provider === 'google' && !settings.apiKey) {
      toast.error("Vui lòng nhập Google API Key trong phần Cài đặt.");
      setLoading(false);
      return;
    }
    if (settings.provider === 'shopaikey' && !settings.shopAIKeyKey) {
      toast.error("Vui lòng nhập ShopAIKey API Key trong phần Cài đặt.");
      setLoading(false);
      return;
    }
    // ... các provider khác ...
};
```

### 2.2 Version Xuất CSV Siêu bền bỉ

```typescript
  const generateCSVData = () => {
    try {
      if (mcqs.length === 0) return "";

      const headers = ["Question", "A", "B", "C", "D", "E", "CorrectAnswer", "ExplanationHTML", "Source", "Difficulty"];
      const rows = mcqs.map((m, idx) => {
        try {
          const esc = (t: string) => `"${(t || "").replace(/"/g, '""')}"`;
          
          // Chốt chặn an toàn cho dữ liệu
          const cleanQ = cleanText(m.question || "Nội dung trống", 'question');
          const formattedQ = formatRichText(cleanQ);

          const rawOps = Array.isArray(m.options) ? m.options : [];
          const ops = [...rawOps];
          while (ops.length < 5) ops.push("");
          const cleanOps = ops.map(o => formatRichText(cleanText(o || "", 'option')));

          const correctIndex = rawOps.findIndex((opt, i) => isOptionCorrect(opt, m.correctAnswer || "", i));
          const correctLetter = correctIndex !== -1 
            ? String.fromCharCode(65 + correctIndex) 
            : ((m.correctAnswer || "").match(/^[A-E]/i)?.[0]?.toUpperCase() || m.correctAnswer || "A");

          let explanationHtml = "";
          if (m.explanation && typeof m.explanation === 'object') {
            explanationHtml = buildAnkiHtml(m.explanation, m.difficulty || "Trung bình", m.depthAnalysis || "Vận dụng");
          } else if (typeof m.explanation === 'string') {
            explanationHtml = formatRichText(m.explanation);
          } else {
            explanationHtml = "<i>Không có giải thích.</i>";
          }

          return [esc(formattedQ), ...cleanOps.map(esc), esc(correctLetter), esc(explanationHtml), esc(m.source || ""), esc(m.difficulty || "")].join(",");
        } catch (err) {
          console.warn(`Lỗi tại câu ${idx + 1}:`, err);
          return null;
        }
      }).filter(Boolean);

      return "\uFEFF" + [headers.join(","), ...rows].join("\n");
    } catch (e: any) {
      toast.error(`Lỗi CSV: ${e.message}`);
      return null;
    }
  };
```

---

## 🛠 3. Danh sách Model Gemini 2026 mới nhất

Cập nhật trong `SettingsModal.tsx`:

- `gemini-3.1-pro-preview`
- `gemini-3.1-flash-lite-preview`
- `gemini-2.5-pro`
- `gemini-2.5-flash`
