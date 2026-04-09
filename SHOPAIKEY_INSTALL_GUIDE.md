# Hướng dẫn Cài đặt ShopAIKey chi tiết (100% Không lỗi)

Tài liệu này hướng dẫn cách thiết lập ShopAIKey vào ứng dụng MCQ AnkiGen để đạt hiệu suất cao nhất, ổn định nhất (Cập nhật 04/2026).

---

## 1. Yêu cầu chuẩn bị

- **API Key**: Lấy tại `shopaikey.com`. Lưu ý: Đây là Key của ShopAIKey, không phải Key trực tiếp từ Google AI Studio.
- **Thư viện Core**: Phải cài đặt SDK chính thức của Google để ứng dụng chạy mượt hơn.

```bash
npm install @google/genai
```

---

## 2. Cấu hình Store (Ghi nhớ Key)

Trong file `src/store/useAppStore.ts`, đảm bảo có trường `shopAIKeyKey`:

```typescript
// Thêm shopAIKeyKey vào interface AppSettings và giá trị mặc định trong settings:
settings: {
  apiKey: '',
  openRouterKey: '',
  shopAIKeyKey: '', // <--- QUAN TRỌNG: Phải có dòng này để tránh lỗi undefined
  provider: 'google',
  model: 'gemini-3.1-flash-lite-preview'
}
```

---

## 3. Cấu hình Giao diện (src/ui/SettingsModal.tsx)

Đảm bảo danh sách mô hình luôn được cập nhật mới nhất từ ShopAIKey:

```tsx
{settings.provider === 'shopaikey' && (
  <optgroup label="Google Gemini Models (2026 Latest)">
    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Mạnh nhất)</option>
    <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite (Nhanh & Rẻ)</option>
    <option value="gemini-2.5-pro">Gemini 2.5 Pro (Rất ổn định)</option>
    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Cân bằng)</option>
  </optgroup>
)}
```

---

## 4. Cấu hình Logic AI (src/core/brain.ts) - CỰC KỲ QUAN TRỌNG

Để tránh lỗi **"Vui lòng nhập Google API Key"** khi đang dùng ShopAIKey, mã nguồn phải được cô lập như sau:

### 4.1 Khởi tạo SDK & Cô lập Provider

Phải bọc lệnh khởi tạo Google AI trong điều kiện `if (settings.provider === 'google')`.

```typescript
// Cấu hình cho ShopAIKey Gemini SDK (Dùng ô shopAIKeyKey)
if (settings.provider === 'shopaikey' && settings.model.toLowerCase().includes('gemini')) {
  const ai = new GoogleGenAI({ 
    apiKey: settings.shopAIKeyKey,
    httpOptions: { baseUrl: 'https://api.shopaikey.com' }
  });
  // ... xử lý ...
} 
// Chỉ khởi tạo Google Key khi Provider là Google
else if (settings.provider === 'google') {
  userKeyRotator.init(settings.apiKey);
  // ... xử lý ...
}
```

### 4.2 Thêm cơ chế Tự động thử lại (Retry)

Thêm hàm này vào đầu file `brain.ts` để xử lý lỗi 503 Overloaded:

```typescript
async function executeWithRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.message.includes("503") || error.message.includes("overloaded")) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); 
        continue;
      }
      throw error;
    }
  }
}
```

---

## 5. Chốt chặn UI (src/App.tsx)

Thêm kiểm tra Key ngay khi nhấn nút trích xuất để báo lỗi chính xác:

```typescript
const handleGenerate = async () => {
  if (settings.provider === 'shopaikey' && !settings.shopAIKeyKey) {
    toast.error("Vui lòng nhập ShopAIKey API Key trong phần Cài đặt.");
    setLoading(false);
    return;
  }
  // ... các bước tiếp theo ...
}
```

---

## 6. Danh sách Model ID "Vàng" 2026

| Mục đích | Model ID | Ghi chú |
| :--- | :--- | :--- |
| **Mạnh nhất** | `gemini-3.1-pro-preview` | Dành cho trích xuất sâu. |
| **Nhanh nhất** | `gemini-3.1-flash-lite-preview` | Dành cho duyệt batch lớn. |
| **Ổn định nhất** | `gemini-2.5-pro` | Ít gặp lỗi 503 nhất. |

---

## 7. Kiểm tra & Khắc phục lỗi

1. **Lỗi "Đòi Google Key"**: Kiểm tra file `brain.ts` xem đã bọc `userKeyRotator.init` trong khối `if` chưa.
2. **Lỗi 501/503**: ShopAIKey đang quá tải -> Chờ 1-2 phút hoặc đổi Model.
3. **Lỗi 401**: Kiểm tra lại Key ShopAIKey (Copy-paste đúng ký tự).

---
*Guide created by ShopAIKey Expert Integration.*
