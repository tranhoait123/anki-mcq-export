# 🧠 AnkiGen Pro - Medical MCQ Extractor

> **Công cụ tự động hóa tạo thẻ Anki từ tài liệu Y khoa (PDF/Ảnh) với sức mạnh của AI & OCR.**
> *Developed by [Tran Hoa](https://github.com/tranhoait123)*

[ **🇻🇳 Tiếng Việt** | [🇺🇸 English](README.en.md) ]

AnkiGen Pro là một dự án cá nhân được xây dựng để giải quyết vấn đề trích xuất câu hỏi trắc nghiệm (MCQ) từ các tài liệu scan chất lượng thấp, ảnh chụp bị cong/mờ, hoặc có nhiều ghi chú viết tay. Hệ thống sử dụng mô hình AI (Google Gemini) kết hợp với Local OCR (Tesseract) để đảm bảo độ chính xác tuyệt đối.

![AnkiGen Pro Demo](https://placehold.co/1200x600/6366f1/ffffff?text=AnkiGen+Pro+Preview)

## ✨ Tính Năng Nổi Bật

-   **🤖 Smart Auto Mode**: Tự động phát hiện và chuyển đổi giữa Cloud AI (nhanh, thông minh) và Local OCR (mạnh mẽ với ảnh mờ) để đảm bảo lấy đủ 100% câu hỏi.
-   **🩺 Medical Professor Persona**: AI được tinh chỉnh để đóng vai "Giáo sư Y khoa", không chỉ đưa ra đáp án mà còn giải thích cơ chế bệnh sinh, chẩn đoán phân biệt và cảnh báo bẫy lâm sàng.
-   **📝 Xử lý đa định dạng**: Hỗ trợ tốt các dạng câu hỏi khó như: Ghép cột (Matching), Đúng/Sai, Chọn nhiều đáp án.
-   **🧹 Chống nhiễu**: Tự động loại bỏ chữ viết tay, vòng tròn khoanh đáp án, vết mực đỏ/xanh làm nhiễu.
-   **🎨 Thẻ Anki Đẹp**: Xuất ra file CSV với định dạng HTML sẵn sàng cho Anki, giao diện thẻ chuyên nghiệp, dễ học.

## 🚀 Hướng Dẫn Cài Đặt

Chỉ cần làm theo các bước đơn giản sau để chạy tool trên máy của bạn.

### 1. Yêu cầu hệ thống
-   **Node.js** (Phiên bản 18 trở lên). [Tải tại đây](https://nodejs.org/).
-   **Git**.

### 2. Tải mã nguồn
Mở Terminal và chạy lệnh:

```bash
git clone https://github.com/tranhoait123/anki-mcq-export.git
cd anki-mcq-export
```

### 3. Cài đặt thư viện
```bash
npm install
```

### 4. Cấu hình API Key
Tạo một file `.env.local` ở thư mục gốc của dự án và dán API Key của Google Gemini vào (lấy tại [aistudio.google.com](https://aistudio.google.com/)).

```env
VITE_GEMINI_API_KEY=AIzaSy...KeyCuaBan,AIzaSy...KeyDuPhong
```
*Mẹo: Bạn có thể nhập nhiều Key cách nhau bằng dấu phẩy `,` để hệ thống tự động xoay vòng nếu bị hết quota.*

### 5. Chạy ứng dụng
```bash
npm run dev
```
Truy cập `http://localhost:5173` để bắt đầu sử dụng!

## 📖 Hướng Dẫn Sử Dụng

1.  **Upload**: Kéo thả file ảnh chụp hoặc PDF đề thi vào.
2.  **Quét**: Nhấn "Quét Tài Liệu" để hệ thống đếm số câu và nhận diện chủ đề.
3.  **Trích xuất**: Nhấn nút trích xuất. Hệ thống sẽ tự động làm sạch dữ liệu và tạo câu hỏi.
4.  **Kiểm tra**: Xem lại các câu hỏi đã trích xuất, đọc giải thích chi tiết.
5.  **Xuất Anki**: Nhấn "Tải CSV Chuẩn Anki" và import vào bộ bài của bạn.

---
*Dự án mã nguồn mở phục vụ cộng đồng sinh viên Y khoa.*
