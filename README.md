# 🧠 MCQ AnkiGen Pro - Medical MCQ Extractor

> **Công cụ tự động hóa tạo thẻ Anki từ tài liệu Y khoa (PDF/Ảnh) với sức mạnh của AI & OCR.**
> *Developed by [PonZ](https://github.com/tranhoait123)*

---

[ [🇻🇳 Tiếng Việt](README.md) | **🇺🇸 English** ]

**MCQ AnkiGen Pro** là giải pháp tối ưu dành cho sinh viên Y khoa, giúp chuyển đổi các tài liệu ôn thi (đề scan mờ, ảnh chụp vội, file PDF) thành các bộ thẻ Anki chất lượng cao chỉ trong tích tắc.

Hệ thống kết hợp sức mạnh của thế hệ AI mới nhất **Google Gemini 3.1 Flash-Lite** (cực nhanh, thông minh) và **Local OCR** để đảm bảo không bỏ sót bất kỳ câu hỏi nào, kể cả những câu có chữ viết tay loằng ngoằng.

---

## 📸 Giao diện Pro Premium (v4.0)

![Giao diện chính](file:///Users/tranhoa/.gemini/antigravity/brain/5c89dc88-1008-4e93-8930-1addfa3e3f3f/uploaded_media_0_1770174963469.png)
*Giao diện kéo thả hiện đại, hỗ trợ file lớn 50MB.*

![Chế độ Split View](file:///Users/tranhoa/.gemini/antigravity/brain/5c89dc88-1008-4e93-8930-1addfa3e3f3f/uploaded_media_1_1770174963469.png)
*Chế độ Split View (Chia đôi màn hình) giúp đối chiếu và chỉnh sửa trực tiếp.*

![Tiến trình xử lý](file:///Users/tranhoa/.gemini/antigravity/brain/5c89dc88-1008-4e93-8930-1addfa3e3f3f/uploaded_media_2_1770174963469.png)
*Giám sát tiến trình trích xuất thời gian thực.*

---

## ✨ Tại sao bạn cần MCQ AnkiGen Pro?

### 1. 🤖 AI đóng vai "Giáo sư Y khoa"

Không chỉ chép lại chữ, AI sẽ phân tích và trích xuất câu hỏi kèm theo giải thích chi tiết:

- **Đáp án cốt lõi**: Tại sao chọn A mà không phải B?
- **Phân tích sâu**: Cơ chế bệnh sinh liên quan.
- **Bằng chứng**: Trích dẫn từ sách giáo khoa (nếu có trong văn bản).

### 2. ⚡️ Vision Page-by-Page & Parallel Processing (Mới v4.5)

- **Vision Page-by-Page**: Quét từng trang tài liệu dưới dạng hình ảnh (Vision) giúp loại bỏ hoàn toàn lỗi "bỏ sót câu hỏi" thường gặp khi quét file PDF dài.
- **Xử lý Song Song (Parallel)**: Chạy đa luồng giúp tăng tốc độ trích xuất gấp đôi.
- **Kỹ thuật Gối đầu (Rolling Window)**: Đảm bảo không mất câu hỏi nằm giữa ranh giới hai trang.

### 3. 💎 Trải nghiệm Pro Premium

- **Không giới hạn lưu trữ**: Lưu hàng nghìn câu hỏi ngay trên trình duyệt (IndexedDB) mà không sợ nặng máy.
- **Chế độ ban đêm (Dark Mode)**: Bảo vệ mắt khi học khuya.
- **Chống trùng lặp**: Tự động phát hiện nếu bạn lỡ nạp cùng một bộ đề nhiều lần.

---

## 🚀 Hướng Dẫn Cài Đặt (Trong 1 phút)

1. **Cài đặt Node.js**: Tải bản mới nhất tại [nodejs.org](https://nodejs.org/).
2. **Tải công cụ**:

   ```bash
   git clone https://github.com/tranhoait123/anki-mcq-export.git
   cd anki-mcq-export
   ```

3. **Cài đặt thư viện**:

   ```bash
   npm install
   ```

4. **Chạy ứng dụng**:

   ```bash
   npm run dev
   ```

   Truy cập `http://localhost:5173` để bắt đầu!

---

## 📜 Nhật ký cập nhật

| Phiên bản | Ngày | Tính năng mới nổi bật | Giao diện |
| :--- | :--- | :--- | :--- |
| **v4.7 (Gemini)** | 28/03/2026 | Khuyên dùng mặc định **Gemini 3.1 Flash-Lite**, bổ sung **Gemini 2.5 Flash** | Cập nhật tuỳ chọn Models |
| **v4.6 (Native)** | 04/02/2026 | **Native PDF Engine (Direct + Smart Chunking)**, Loại bỏ hoàn toàn lỗi Worker/Font, Quét Gối đầu (Overlap Scanning) | Thanh tiến trình chi tiết |
| **v4.0 (Pro)** | 04/02/2026 | **Giới hạn 50MB**, Lưu trữ vĩnh viễn (IndexedDB) | Giao diện Premium, Split View |
| **v3.5** | 03/02/2026 | Xoay vòng Key API, Tự động kiểm tra lỗi | Glassmorphism Design |
| **v3.0** | 02/02/2026 | Phát hiện câu hỏi trùng lặp | Bảng điều khiển chi tiết |

---
*Dự án mã nguồn mở phục vụ cộng đồng sinh viên Y khoa.*
**Phát triển bởi PonZ**
