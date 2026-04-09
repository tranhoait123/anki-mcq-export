# 🛡️ Medical Anki Generator: Pipeline Resilience 2.0 (April 2026)

Tài liệu này tổng hợp các cơ chế cốt lõi đảm bảo khả năng **trích xuất thành công 100%** và chống chịu lỗi tuyệt đối của hệ thống Anki Generator.

---

## 1. Cơ chế Chia để Trị (Recursive Subdivision 🧩)
Đây là "át chủ bài" trong phiên bản 2.0. Khi một Batch gặp lỗi (quá tải, lỗi định dạng, hoặc do AI bị ngợp), hệ thống không chỉ "thử lại" mà sẽ chủ động hành động:
- **Tự động chia đôi**: Nếu Batch thất bại sau các lần thử cơ bản, hệ thống sẽ chia văn bản của Batch đó thành 2 phần nhỏ hơn.
- **Xử lý đệ quy**: Mỗi phần nhỏ tiếp tục được xử lý độc lập. Nếu vẫn fail, nó lại tiếp tục chia đôi.
- **Kết quả**: Đảm bảo không bỏ sót bất kỳ đoạn văn bản nào, ngay cả khi gặp những đoạn dữ liệu cực kỳ phức tạp.

## 2. Xoay vòng Key & Thử lại Nâng cao (Unified Rotation & Advanced Retry 🔄)
Thay vì chỉ thử lại trên một Key cố định, hệ thống sử dụng trình điều phối `executeWithUserRotation`:
- **Pool Key thông minh**: Tự động xoay vòng qua danh sách 10+ API Key (Google GenAI) để tránh lỗi Rate Limit (429).
- **Thử lại 15 lần (Exponential Backoff)**: Mỗi Batch có tới 15 cơ hội thành công với thời gian chờ tăng dần (Jittered Backoff), giúp vượt qua các thời điểm Google Server bị quá tải (503).
- **Fallback Model**: Nếu Model chính (như `gemini-1.5-pro`) liên tục lỗi, hệ thống sẽ tự động chuyển sang `gemini-1.5-flash` để ưu tiên tốc độ và sự ổn định.

## 3. Tự vá lỗi JSON (Fuzzy JSON Repair 🛠️)
AI đôi khi trả về JSON bị cắt cụt do hết Token hoặc lỗi định dạng nhẹ. Hàm `extractJson` phiên bản mới có khả năng:
- **Cân bằng ngoặc**: Tự động đóng các dấu `}` hoặc `]` còn thiếu.
- **Loại bỏ nhiễu**: Trích xuất chính xác khối JSON nằm giữa các đoạn văn bản giải thích của AI.
- **Deep Repair**: Nếu JSON bị hỏng giữa chừng một mảng, hệ thống sẽ lùi lại dấu phẩy gần nhất và đóng mảng sạch sẽ để vẫn cứu vãn được các câu hỏi đã trích xuất xong.

## 4. Bảo toàn Ngữ cảnh Lâm sàng (Case Study Persistence 🩺)
Đối với sinh viên Y khoa, ngữ cảnh là tất cả. Hệ thống đã tích hợp chỉ thị:
- **Nguyên văn 100%**: Không tóm tắt tình huống lâm sàng (Case study).
- **Lặp lại thông minh**: Nếu 1 Case Study có 5 câu hỏi đi kèm, hệ thống sẽ lặp lại toàn bộ Case đó vào đầu mỗi câu hỏi.
- **Kết quả**: Mỗi thẻ Anki khi xuất ra đều là một đơn vị học tập độc lập, đầy đủ thông tin, không cần lật lại thẻ trước đó.

## 5. Chống trùng lặp đa tầng (Multi-Layer De-duplication 🔍)
- **Fuzzy Matching**: So sánh độ tương đồng nội dung (>90%) thay vì so sánh chuỗi chính xác.
- **Logic Flip Detection**: Phát hiện các câu hỏi có nội dung giống nhau nhưng logic ngược (VD: "Phát biểu ĐÚNG" vs "Phát biểu SAI") để không xóa nhầm.

---

> [!TIP]
> **Hướng dẫn cho người dùng**: Để đạt hiệu suất cao nhất, hãy nhập các API Key cách nhau bằng dấu phẩy trong phần Cài đặt. Hệ thống sẽ tự động kích hoạt chế độ "Siêu ổn định" (Resilience Mode).
