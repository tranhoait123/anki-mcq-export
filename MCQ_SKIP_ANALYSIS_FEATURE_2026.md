# 🎯 Hướng dẫn Tích hợp Tính năng "Bỏ qua bước Quét" (Tiết kiệm 100% Token Phân tích)

Tài liệu này giúp bạn nhân bản tính năng bỏ qua bước ước lượng câu hỏi ban đầu để tiết kiệm Token vào bản App Duplicate của mình một cách chính xác nhất.

---

## 🛠 Bước 1: Cập nhật Interface Cài đặt (src/types.ts)

Thêm thuộc tính `skipAnalysis` vào interface `AppSettings`:

```typescript
export interface AppSettings {
  // ... các thuộc tính cũ ...
  skipAnalysis?: boolean; // <--- Thêm dòng này để hỗ trợ tính năng lưu trạng thái
}
```

---

## 💾 Bước 2: Khởi tạo giá trị mặc định (src/store/useAppStore.ts)

Đảm bảo trạng thái ban đầu là `false` để người dùng chủ động bật khi cần:

```typescript
  settings: {
    // ... các thuộc tính cũ ...
    skipAnalysis: false, // <--- Thêm dòng này
  },
```

---

## ⚙️ Bước 3: Cập nhật Giao diện Cài đặt (src/ui/SettingsModal.tsx)

Thêm khu vực cấu hình tối ưu hóa vào Modal Cài đặt:

```tsx
{/* Thêm đoạn này vào gần cuối Modal, trước nút Đã Xong */}
<div className="pt-2">
    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
        Tối ưu hóa và Tiết kiệm
    </label>
    
    <div className="flex items-center gap-3 p-3 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20 mb-3">
        <input 
            type="checkbox"
            id="skipAnalysis"
            checked={settings.skipAnalysis}
            onChange={e => setSettings({ ...settings, skipAnalysis: e.target.checked })}
            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
        />
        <div className="flex-1">
            <label htmlFor="skipAnalysis" className="text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                Bỏ qua bước quét số câu (Tiết kiệm Token)
            </label>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
                Bật để trích xuất ngay lập tức, không cần đếm tổng số câu trước.
            </p>
        </div>
    </div>
</div>
```

---

## 🧠 Bước 4: Chốt chặn Logic Xử lý (src/App.tsx)

Đây là phần logic trung tâm để điều hướng bỏ qua bước gọi API phân tích.

### 4.1 Sửa hàm `handleAnalyze`:
```typescript
const handleAnalyze = async () => {
    // ... các kiểm tra Key ...

    setAudit(null);
    try {
      // CHỐT CHẶN SKIP:
      if (settings.skipAnalysis) {
        setAnalysis({
          topic: "Bỏ qua thuộc tính quét",
          estimatedCount: 0,
          questionRange: "Toàn bộ tài liệu",
          confidence: "N/A"
        });
        toast.info("Đã bỏ qua bước quét tài liệu.");
        setAnalyzing(false);
        return;
      }

      const filesToUse = await prepareFiles();
      const res = await analyzeDocument(filesToUse, settings);
      setAnalysis(res);
      // ...
    }
    // ...
```

### 4.2 Cập nhật hiển thị Tiến độ (App.tsx)
Khi số câu ước lượng bằng 0, thanh tiến độ sẽ hiển thị theo dạng đếm thay vì %.

```tsx
{/* Trong phần Progress Bar render */}
<div className="flex justify-between items-center text-sm font-medium text-indigo-900">
    <span className="flex items-center gap-2"> {progressStatus} </span>
    <span>
        {analysis?.estimatedCount && analysis.estimatedCount > 0 
            ? `${Math.round((currentCount / analysis.estimatedCount) * 100)}%`
            : `Đã xong ${currentCount} câu`}
    </span>
</div>
<div className="h-2 bg-indigo-50 rounded-full overflow-hidden">
    <div
        className={`h-full bg-indigo-600 transition-all duration-300 ease-out ${(!analysis?.estimatedCount || analysis.estimatedCount === 0) ? 'animate-pulse' : ''}`}
        style={{ width: `${analysis?.estimatedCount && analysis.estimatedCount > 0 ? Math.min(100, (currentCount / analysis.estimatedCount) * 100) : 100}%` }}
    />
</div>
```

### 4.3 Chốt chặn Ổn định (src/core/anki.ts) - GIẢM THIỂU CRASH 
Đây là bản sửa lỗi giúp App không bao giờ bị sập khi AI trả về dữ liệu thiếu hoặc sai kiểu.

```typescript
export const formatRichText = (text: any): string => {
  // Chốt chặn: Nếu không phải string thì không xử lý để tránh lỗi .includes()
  if (typeof text !== 'string') return "";
  let html = text;
  
  // Logic xử lý bảng, bold, italic...
  // ...
  return html;
};

export const buildAnkiHtml = (exp: Explanation, difficulty: string, depth: string) => {
  if (!exp) return "<i>Dữ liệu giải thích lỗi.</i>";
  
  return `<b>🎯 ĐÁP ÁN CỐT LÕI</b><br>
${formatRichText(exp.core || "")}<br><br>
<b>📚 BẰNG CHỨNG</b><br>
${formatRichText(exp.evidence || "")}<br><br>
<b>💡 PHÂN TÍCH SÂU</b><br>
${formatRichText(exp.analysis || "")}<br><br>
${exp.warning ? `<b>⚠️ CẢNH BÁO</b><br>${formatRichText(exp.warning)}<br><br>` : ''}
<b>📊 ĐỘ KHÓ:</b> <b>${difficulty || "N/A"}</b><br>
<b>🧠 TƯ DUY:</b> <b>${depth || "N/A"}</b>`.trim();
};
```

---
*Tài liệu này tổng hợp toàn bộ tinh hoa bản sửa lỗi 2026. Chúc bạn nhân bản thành công!*
