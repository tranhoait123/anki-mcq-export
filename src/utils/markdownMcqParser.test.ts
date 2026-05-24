import { describe, it, expect } from 'vitest';
import { parseMarkdownMcqs } from './markdownMcqParser';

describe('Markdown MCQ Parser', () => {
  it('returns empty and count 0 if no MCQs are detected', () => {
    const text = 'Đây là tài liệu thông thường không có câu hỏi trắc nghiệm nào.';
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(0);
    expect(result.structuredText).toBe('');
  });

  it('parses standard Vietnamese MCQ format correctly', () => {
    const text = `
# ĐỀ THI TRẮC NGHIỆM

Câu 1: Nguyên nhân phổ biến nhất gây suy tim trái cấp là gì?
A. Nhồi máu cơ tim cấp.
B. Hẹp van hai lá nặng.
C. Viêm cơ tim cấp.
D. Tăng huyết áp cấp cứu.

Câu 2. Triệu chứng lâm sàng chính của viêm ruột thừa cấp là?
A. Sốt cao kèm rét run.
B. Đau khu trú hố chậu phải.
C. Nôn vọt dữ dội.
D. Tiêu chảy phân lỏng nhiều nước.
`;
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(2);
    expect(result.structuredText).toContain('[MARKDOWN_MCQ_COUNT: 2]');
    expect(result.structuredText).toContain('<<<MCQ 1>>>');
    expect(result.structuredText).toContain('Question: Câu 1: Nguyên nhân phổ biến nhất gây suy tim trái cấp là gì?');
    expect(result.structuredText).toContain('A. Nhồi máu cơ tim cấp.');
    expect(result.structuredText).toContain('<<<MCQ 2>>>');
  });

  it('parses options and detects correct answer via checkbox symbols', () => {
    const text = `
Câu 1. Thuốc được lựa chọn hàng đầu trong điều trị sốc phản vệ là:
A. Dopamine
✅ B. Adrenaline
C. Methylprednisolone
D. Salbutamol
`;
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(1);
    expect(result.structuredText).toContain('✅ B. Adrenaline');
    expect(result.structuredText).not.toContain('✅ A.');
    expect(result.structuredText).not.toContain('✅ C.');
  });

  it('parses correct answer marked via bold style or answer line', () => {
    const text = `
Câu 1. Kháng sinh nhóm nào sau đây gây độc tính trên tai và thận?
A. Penicillin
B. Macrolid
C. **Aminoglycosid**
D. Cephalosporin

Câu 2. Tác nhân thường gặp nhất gây viêm phổi cộng đồng là:
A. Mycoplasma pneumoniae
B. Streptococcus pneumoniae
C. Haemophilus influenzae
D. Chlamydia pneumoniae
Đáp án đúng: B
`;
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(2);
    expect(result.structuredText).toContain('✅ C. Aminoglycosid');
    expect(result.structuredText).toContain('✅ B. Streptococcus pneumoniae');
  });

  it('handles pure numbered questions only if they look like actual MCQs', () => {
    const text = `
1. Khám lâm sàng bệnh nhân có hội chứng đông đặc phổi thấy:
A. Rì rào phế nang giảm.
B. Rung thanh tăng.
C. Gõ đục.
D. Cả 3 ý trên đều đúng.

2. Đây là một danh sách bình thường không phải trắc nghiệm:
- Mục này dài.
- Mục kia ngắn.

3. Đây cũng là danh sách thường:
Đây là câu hỏi tự luận không có phương án trả lời.
`;
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(1);
    expect(result.structuredText).toContain('<<<MCQ 1>>>');
    expect(result.structuredText).toContain('Question: 1. Khám lâm sàng bệnh nhân có hội chứng đông đặc phổi thấy:');
  });

  it('parses clinical vignettes (shared case context) correctly', () => {
    const text = `
Dữ kiện sau đây dùng cho câu 1-2:
Bệnh nhân nam, 65 tuổi, tiền sử tăng huyết áp 10 năm, nhập viện vì đau ngực sau xương ức dữ dội giờ thứ 3.

Câu 1. Cần thực hiện xét nghiệm khẩn cấp nào đầu tiên để chẩn đoán?
A. Điện tâm đồ 12 chuyển đạo.
B. Định lượng Troponin T.
C. Siêu âm tim tại giường.
D. Chụp X-quang ngực thẳng.

Câu 2. Nếu chẩn đoán là nhồi máu cơ tim ST chênh lên giờ thứ 3, hướng xử trí tối ưu nhất là gì?
A. Điều trị nội khoa bảo tồn tích cực.
B. Can thiệp động mạch vành qua da (PCI) thì đầu.
C. Sử dụng thuốc tiêu sợi huyết ngay tại khoa cấp cứu.
D. Phẫu thuật bắc cầu chủ vành khẩn cấp.
`;
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(2);
    expect(result.structuredText).toContain('[TÌNH HUỐNG]\nDữ kiện sau đây dùng cho câu 1-2: Bệnh nhân nam, 65 tuổi, tiền sử tăng huyết áp 10 năm, nhập viện vì đau ngực sau xương ức dữ dội giờ thứ 3.\n\n[CÂU HỎI]\nCâu 1. Cần thực hiện xét nghiệm khẩn cấp nào đầu tiên để chẩn đoán?');
    expect(result.structuredText).toContain('[TÌNH HUỐNG]\nDữ kiện sau đây dùng cho câu 1-2: Bệnh nhân nam, 65 tuổi, tiền sử tăng huyết áp 10 năm, nhập viện vì đau ngực sau xương ức dữ dội giờ thứ 3.\n\n[CÂU HỎI]\nCâu 2. Nếu chẩn đoán là nhồi máu cơ tim ST chênh lên giờ thứ 3, hướng xử trí tối ưu nhất là gì?');
  });

  it('detects answers from a trailing answer key section', () => {
    const text = `
Câu 1. Tác nhân thường gặp nhất gây sốt mò là:
A. Rickettsia prowazekii
B. Rickettsia typhi
C. Orientia tsutsugamushi
D. Coxiella burnetii

Câu 2. Thuốc điều trị đặc hiệu sốt mò là:
A. Penicillin G
B. Ciprofloxacin
C. Doxycycline
D. Ceftriaxone

BẢNG ĐÁP ÁN:
Câu 1 - C, Q2: C
`;
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(2);
    expect(result.structuredText).toContain('✅ C. Orientia tsutsugamushi');
    expect(result.structuredText).toContain('✅ C. Doxycycline');
  });

  it('strips markdown characters from questions and options', () => {
    const text = `
## **Câu 1.** *Triệu chứng* nào sau đây gặp trong **hội chứng thận hư**?
- A. **Protein niệu** > 3.5 g/24h.
- B. **Albumin máu** < 30 g/L.
- C. Phù to toàn thân.
- D. Tất cả các ý trên.
`;
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(1);
    expect(result.structuredText).toContain('Question: Câu 1. Triệu chứng nào sau đây gặp trong hội chứng thận hư?');
    expect(result.structuredText).toContain('A. Protein niệu > 3.5 g/24h.');
  });

  it('parses user provided THA-TK document successfully', () => {
    const text = `# THA-TK — 1. Định nghĩa & Dịch tễ

# THA-TK — 1. Định nghĩa & Dịch tễ

<aside>
📌

Mục tiêu: phân loại đúng các rối loạn THA thai kỳ, xác định yếu tố nguy cơ cao/trung bình cho TSG, ước tính tỷ lệ HDP. Miền năng lực: Recall → Áp dụng. **10 case** (Q001–Q010).

</aside>

📊 MINI-BLUEPRINT

| **Q#** | **Dạng MCQ** | **Miền** | **Bloom** | **Scenario** |
| --- | --- | --- | --- | --- |
| Q001 | Most likely Dx | CĐ | Áp dụng | Phòng khám |
| Q002 | Calculation/Planning | DT | Áp dụng | Kế hoạch BV |
| Q003 | Risk factor ID | DT | Áp dụng | Phòng khám |
| Q004 | Risk factor ID | DT | Áp dụng | Sàng lọc |
| Q005 | Preventive counseling | DT | Áp dụng | Hậu sản |
| Q006 | Underlying mechanism | Cơ chế | Phân tích | Nghiên cứu |
| Q007 | Most likely Dx | CĐ | Áp dụng | Ngoại trú |
| Q008 | Prognosis | TL | Áp dụng | Nội trú |
| Q009 | Screening/Prophylaxis | PB | Áp dụng | Phòng khám |
| Q010 | Risk assessment | DT | Đánh giá | Phức tạp |

---

## Q001

Thai phụ 30 tuổi, PARA 1001, khám thai định kỳ tuần 28. Trước mang thai huyết áp bình thường. Đo HA tại phòng khám: 144/92 mmHg, đo lại sau 4 giờ: 146/94 mmHg. Không đau đầu, không nhìn mờ, không đau thượng vị. Phù nhẹ 2 chi dưới. Xét nghiệm nước tiểu: protein (−). Công thức máu: tiểu cầu 220.000/μL. AST 22 U/L, ALT 18 U/L. Creatinine 0,7 mg/dL.

**Câu hỏi:** Chẩn đoán phù hợp nhất cho bệnh nhân này là gì?

A. Tiền sản giật không có dấu hiệu nặng

B. Tăng huyết áp mạn tính

C. Tăng huyết áp thai kỳ

D. Tiền sản giật có dấu hiệu nặng

**Đáp án:** C — HA ≥ 140/90 sau 20w, không protein niệu, không tổn thương cơ quan

---

## Q002

Bác sĩ trưởng khoa sản bệnh viện tuyến tỉnh lập kế hoạch dự trù thuốc năm 2026. Khoa theo dõi khoảng 2000 ca sinh mỗi năm. Bác sĩ cần ước tính số thai phụ có khả năng mắc rối loạn tăng huyết áp trong thai kỳ để phân bổ giường bệnh nặng và dự trù thuốc hạ áp đường tĩnh mạch, MgSO₄.

**Câu hỏi:** Số lượng thai phụ ước tính cần theo dõi tích cực vì rối loạn THA trong thai kỳ mỗi năm phù hợp nhất là bao nhiêu?

A. 20–40 thai phụ

B. 100–200 thai phụ

C. 400–600 thai phụ

D. 800–1000 thai phụ

**Đáp án:** B — HDP chiếm ≈ 5–10% thai kỳ; 2000 × 5–10% = 100–200

---

## Q003

Thai phụ 25 tuổi, PARA 0, thai 10 tuần, khám thai lần đầu. Tiền căn: không bệnh lý. HA 118/76 mmHg, BMI 24 kg/m². Không có tiền sử gia đình tiền sản giật. Bác sĩ đánh giá các yếu tố nguy cơ tiền sản giật để quyết định chỉ định aspirin dự phòng.

**Câu hỏi:** Yếu tố nào sau đây được xếp loại là yếu tố nguy cơ **trung bình** cho tiền sản giật theo khuyến cáo ACOG?

A. Tăng huyết áp mạn tính

B. Đái tháo đường type 1 hoặc type 2

C. Hội chứng kháng phospholipid

D. Con so (nullipara)

**Đáp án:** D — Con so là YTNC trung bình; A, B, C đều là YTNC cao

---

## Q004

Thai phụ 38 tuổi, PARA 2002, thai 12 tuần, khám thai lần đầu. Tiền căn: tiền sản giật nặng ở lần mang thai đầu tiên (sinh non 28 tuần), lần mang thai thứ hai không biến chứng. BMI 32 kg/m². HA hiện tại 125/80 mmHg. Chức năng thận bình thường. Bác sĩ cần xác định yếu tố nguy cơ mạnh nhất để tư vấn và lập kế hoạch dự phòng.

**Câu hỏi:** Yếu tố nguy cơ **cao nhất** cho tiền sản giật ở bệnh nhân này là gì?

A. Tiền căn tiền sản giật thai kỳ trước

B. Tuổi mẹ ≥ 35

C. BMI ≥ 30 kg/m²

D. Khoảng cách giữa 2 lần mang thai

**Đáp án:** A — Tiền căn TSG (đặc biệt sớm + nặng) là YTNC cao; B, C, D là YTNC trung bình

---

## Q005

Thai phụ 29 tuổi, PARA 1001, hậu sản 6 tuần. Thai kỳ vừa qua biến chứng tiền sản giật nặng tại tuần 32, phải mổ lấy thai cấp cứu do suy thai cấp. Hiện HA bình thường, chức năng gan thận bình thường. Bệnh nhân dự định mang thai lại sau 1 năm và hỏi về nguy cơ tiền sản giật ở lần mang thai tiếp theo.

**Câu hỏi:** Tỷ lệ tái phát tiền sản giật ở lần mang thai tiếp theo phù hợp nhất để tư vấn cho bệnh nhân là bao nhiêu?

A. < 5%

B. 5–10%

C. 15–25%

D. 40–50%

**Đáp án:** C — Tái phát TSG ≈ 15–25%, cao hơn nếu TSG sớm + nặng ở lần trước

---

## Q006

Một nghiên cứu thuần tập lớn phân tích mối liên quan giữa hút thuốc lá và tiền sản giật trên 50.000 thai phụ. Kết quả: thai phụ hút thuốc có tỷ lệ tiền sản giật thấp hơn đáng kể (OR 0,67; 95% CI 0,55–0,82). Tuy nhiên, nhóm hút thuốc có tỷ lệ thai giới hạn tăng trưởng trong tử cung (FGR) cao gấp 2,5 lần và tỷ lệ rau bong non tăng.

**Câu hỏi:** Cơ chế nào giải thích phù hợp nhất cho hiện tượng nghịch lý giảm tiền sản giật nhưng tăng FGR ở thai phụ hút thuốc?

A. Carbon monoxide ức chế giải phóng sFlt-1 từ rau, giảm rối loạn nội mô mẹ nhưng COHb gây thiếu oxy thai mạn

B. Nicotine kích thích tiết aldosterone thượng thận, giảm huyết áp mẹ nhưng gây co thắt mạch máu rau

C. Hút thuốc tăng prostacyclin nội mô tử cung, giảm THA mẹ nhưng ức chế phát triển nhau thai qua apoptosis

D. Cadmium trong thuốc lá ức chế hoạt hóa bổ thể, giảm viêm mạch mẹ nhưng gây hoại tử gai rau trực tiếp

**Đáp án:** A — CO ức chế sFlt-1 → giảm rối loạn nội mô mẹ (↓ TSG); COHb gây thiếu oxy thai mạn → FGR

---

## Q007

Thai phụ 32 tuổi, PARA 0, thai 24 tuần. Đến khám vì đau đầu nhẹ 2 ngày. HA 148/96 mmHg, đo lại sau 4 giờ: 152/98 mmHg. Trước mang thai HA bình thường. Phù mặt và bàn tay mới xuất hiện. Xét nghiệm: protein niệu dipstick 2+, tỷ số protein/creatinine niệu 0,35 mg/mg. Tiểu cầu 185.000/μL. AST 28 U/L, ALT 24 U/L. Creatinine 0,8 mg/dL. Không nhìn mờ, không đau thượng vị.

**Câu hỏi:** Chẩn đoán phù hợp nhất cho bệnh nhân này là gì?

A. Tăng huyết áp thai kỳ

B. Tiền sản giật không có dấu hiệu nặng

C. Tiền sản giật có dấu hiệu nặng

D. Tăng huyết áp mạn tính

**Đáp án:** B — HA ≥ 140/90 sau 20w + protein niệu (P/C ≥ 0,3), không severe features

---

## Q008

Thai phụ 31 tuổi, PARA 0, thai 32 tuần, nhập viện với tiền sản giật nặng: HA 172/114 mmHg, protein niệu 3+, đau đầu dữ dội, nhìn mờ. Bác sĩ bắt đầu labetalol tĩnh mạch và MgSO₄. Tiểu cầu hiện tại 145.000/μL, AST 42 U/L. Bác sĩ nội trú cần lập kế hoạch theo dõi xét nghiệm đánh giá nguy cơ diễn tiến HELLP syndrome.

**Câu hỏi:** Tỷ lệ ước tính diễn tiến HELLP syndrome ở bệnh nhân tiền sản giật nặng phù hợp nhất là bao nhiêu?

A. 1–2%

B. 3–5%

C. 5–8%

D. 10–20%

**Đáp án:** D — HELLP ≈ 10–20% TSG nặng; cần theo dõi CBC + LFT mỗi 6–12h

---

## Q009

Thai phụ 34 tuổi, PARA 0, thai 11 tuần, khám thai lần đầu. Tiền căn: khỏe mạnh, không THA, không ĐTĐ, không bệnh thận, không APS. BMI 33 kg/m². HA 122/78 mmHg. Bệnh nhân có 2 yếu tố: con so và BMI ≥ 30. Bác sĩ cần xác định đủ chỉ định aspirin dự phòng TSG hay không.

**Câu hỏi:** Theo khuyến cáo ACOG, số lượng yếu tố nguy cơ trung bình tối thiểu cần có để chỉ định aspirin dự phòng TSG (khi không có yếu tố nguy cơ cao) là bao nhiêu?

A. ≥ 2 yếu tố nguy cơ trung bình

B. ≥ 3 yếu tố nguy cơ trung bình

C. ≥ 1 yếu tố nguy cơ trung bình

D. ≥ 4 yếu tố nguy cơ trung bình

**Đáp án:** A — ACOG: ≥ 1 YTNC cao HOẶC ≥ 2 YTNC trung bình → aspirin 81–150 mg/ngày từ 12–16w

---

## Q010

Thai phụ 40 tuổi, PARA 0, thai 11 tuần. Tiền căn: lupus ban đỏ hệ thống (SLE) ổn định 3 năm với hydroxychloroquine, kháng thể kháng cardiolipin IgG dương tính yếu 1 lần 2 năm trước (chưa tái kiểm tra). BMI 28 kg/m². HA 132/84 mmHg. Creatinine 0,9 mg/dL, protein niệu (−). Bổ thể C3/C4 bình thường. Bác sĩ cần đánh giá mức nguy cơ TSG và quyết định chiến lược dự phòng.

**Câu hỏi:** Đánh giá nào sau đây phù hợp nhất về nguy cơ tiền sản giật và chiến lược dự phòng cho bệnh nhân này?

A. Nguy cơ thấp — SLE ổn định và aCL dương 1 lần chưa đủ APS, không cần aspirin

B. Nguy cơ trung bình — cần thêm yếu tố nguy cơ trung bình mới đủ chỉ định aspirin

C. Nguy cơ cao — SLE là YTNC cao độc lập, đủ chỉ định aspirin liều thấp từ 12–16 tuần

D. Nguy cơ rất cao — cần kháng đông liều điều trị phối hợp aspirin vì nghi ngờ APS

**Đáp án:** C — SLE là YTNC cao cho TSG (độc lập); aspirin 100–150 mg; aCL 1 lần chưa đủ CĐ APS`;
    
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(10);
    
    // Check some specific questions are parsed and correct answers are detected
    expect(result.structuredText).toContain('<<<MCQ 1>>>');
    expect(result.structuredText).toContain('✅ C. Tăng huyết áp thai kỳ');
    
    expect(result.structuredText).toContain('<<<MCQ 3>>>');
    expect(result.structuredText).toContain('✅ D. Con so (nullipara)');
    
    expect(result.structuredText).toContain('<<<MCQ 6>>>');
    expect(result.structuredText).toContain('✅ A. Carbon monoxide');
    
    expect(result.structuredText).toContain('<<<MCQ 10>>>');
    expect(result.structuredText).toContain('✅ C. Nguy cơ cao');
  });

  it('parses user provided Capstone document successfully', () => {
    const text = `# THA-TK — Đề tích hợp Capstone

# THA-TK — Đề tích hợp Capstone

<aside>
🧠

Mục tiêu: tình huống phức tạp tích hợp đa lĩnh vực — phân loại + chẩn đoán + điều trị + biến chứng + tiên lượng. **30 case** (Q171–Q200).

</aside>

---

## Q171

Thai phụ 28 tuổi, PARA 0, thai 33 tuần. HA 168/112 mmHg. Protein niệu P/C 0,8. Tiểu cầu 90.000/μL. AST 125 U/L. LDH 750 U/L. Đau thượng vị. Nhìn mờ thoáng qua.

**Câu hỏi:** Phân loại đầy đủ và quyết định xử trí ban đầu phù hợp nhất là gì?

A. TSG nặng + HELLP (partial: TC < 100k + AST↑ + LDH↑); xử trí: MgSO₄ + hạ áp cấp (labetalol IV) + corticosteroid + chấm dứt thai kỳ trong 24–48h

B. TSG không nặng — expectant đến 37w

C. HELLP đơn thuần — không cần MgSO₄

D. THA thai kỳ — theo dõi ngoại trú

**Đáp án:** A — Severe features: HA ≥ 160/110 + nhìn mờ + đau thượng vị + HELLP (TC↓ + AST↑ + LDH↑); ≥ 34w: chấm dứt; < 34w: corticosteroid 24–48h nếu ổn định rồi chấm dứt

---

## Q172

Thai phụ 35 tuổi, THA mạn 5 năm, thai 26 tuần. Đang dùng methyldopa 500 mg × 3. HA 155/100 mmHg. Protein niệu mới xuất hiện P/C 0,6. Tiểu cầu 165.000/μL. sFlt-1/PlGF = 95.

**Câu hỏi:** Chẩn đoán và hướng xử trí phù hợp nhất là gì?

A. THA mạn kiểm soát chưa tốt — tăng liều methyldopa

B. THA mạn đơn thuần — không có TSG

C. TSG chồng ghép trên THA mạn (protein niệu mới + sFlt-1/PlGF > 85 rule-in); tăng liều hạ áp + MgSO₄ + corticosteroid; cân nhắc expectant nếu ổn định đến 48h; chấm dứt

D. THA thai kỳ — theo dõi

**Đáp án:** C — THA mạn + protein niệu mới + sFlt-1/PlGF > 85 = superimposed PE; 26w: corticosteroid + expectant ngắn nếu ổn; chấm dứt khi bất ổn hoặc 34w

---

## Q173

Thai phụ 30 tuổi, tuần 35. HA 150/96 mmHg. Protein niệu P/C 0,4. Tiểu cầu 180.000/μL. AST 28 U/L. Không đau đầu, không nhìn mờ. Thai phát triển bình thường.

**Câu hỏi:** Phân loại và quản lý phù hợp nhất là gì?

A. TSG nặng — mổ lấy thai ngay

B. TSG không nặng (HA < 160/110, không severe features); expectant management với theo dõi sát đến 37 tuần; hạ áp nếu HA ≥ 140/90

C. THA thai kỳ — không cần theo dõi protein

D. THA mạn — không cần can thiệp

**Đáp án:** B — TSG không nặng: HA < 160/110, protein niệu (+), không severe features; expectant đến 37w; theo dõi: HA 2×/ngày, CLS 2×/tuần, CTG, siêu âm

---

## Q174

Thai phụ 27 tuổi, TSG nặng tuần 31. Đang truyền MgSO₄ + labetalol IV. Đột ngột co giật tonic-clonic 2 phút. Sau giật: GCS 10, đồng tử đều, không liệt khu trú.

**Câu hỏi:** Xử trí đầy đủ từ cơn giật đến quyết định chấm dứt thai kỳ là gì?

A. Phenytoin IV → chờ ổn định 24h → mổ

B. Diazepam → gây mê → mổ cấp cứu ngay

C. Chờ cơn giật tự hết → theo dõi

D. MgSO₄ bolus 2g IV/5′ (vì đang dùng: thêm bolus) + bảo vệ đường thở + oxy + nghiêng trái; ổn định mẹ 1–4h → chấm dứt thai kỳ; CT não nếu dấu TK khu trú hoặc GCS không cải thiện

**Đáp án:** D — Eclampsia trên nền MgSO₄: bolus thêm 2g; không dùng diazepam/phenytoin; ổn định mẹ 1–4h (không mổ giữa cơn giật); chấm dứt thai kỳ sau ổn định; CT nếu bất thường thần kinh

---

## Q175

Thai phụ 31 tuổi, song thai hai noãn, tuần 29. HA 162/105 mmHg. Protein niệu 3+. Tiểu cầu 95.000/μL. AST 180 U/L. LDH 850 U/L.

**Câu hỏi:** Thách thức đặc biệt khi quản lý TSG nặng + HELLP ở song thai là gì?

A. Song thai bảo vệ khỏi HELLP

B. Xử trí giống đơn thai hoàn toàn

C. Chỉ cần giảm số thai

D. Song thai: nguy cơ TSG cao hơn + corticosteroid cho cả 2 thai + cân nhắc gây mê (TC < 100k) + mổ lấy thai thường ưu tiên; xuất huyết sau sinh cao hơn (tử cung căng quá mức)

**Đáp án:** D — Song thai + HELLP: phức tạp hơn; TC < 100k → thận trọng gây tê; mổ ưu tiên (ngôi, HELLP); corticosteroid cho cả 2 thai; nguy cơ PPH cao do overdistension → chuẩn bị máu

---

## Q176

Thai phụ 29 tuổi, tuần 34. HA 155/98 mmHg. Protein niệu 2+. Tiểu cầu 45.000/μL. Schistocytes 3+. LDH 2200 U/L. Creatinine 2,5 mg/dL. ADAMTS13: 65% (bình thường).

**Câu hỏi:** Chẩn đoán phân biệt và xử trí phù hợp nhất là gì?

A. TTP — plasmapheresis ngay

B. HELLP (ADAMTS13 > 10% loại trừ TTP); chấm dứt thai kỳ + truyền TC trước mổ + hồi sức; schistocytes có thể gặp trong HELLP (TMA)

C. HUS — eculizumab

D. ITP — IVIG + corticosteroid

**Đáp án:** B — DDx TMA thai kỳ: HELLP (ADAMTS13 bt), TTP (ADAMTS13 < 10%), aHUS (complement); ADAMTS13 65% → loại TTP; HELLP + TSG: chấm dứt thai kỳ là điều trị chính

---

## Q177

Thai phụ 26 tuổi, TSG nặng tuần 29. HA ổn với labetalol. Betamethasone đã tiêm đủ 2 liều. 48h sau: HA vẫn 152/98 mmHg, tiểu cầu 115.000/μL, AST 55 U/L.

**Câu hỏi:** Tiếp tục expectant hay chấm dứt thai kỳ?

A. Chấm dứt ngay — đã đủ corticosteroid

B. Expectant không cần theo dõi thêm

C. Expectant có thể tiếp tục vì bệnh ổn định (HA kiểm soát, TC > 100k, AST chỉ tăng nhẹ); theo dõi sát; chấm dứt ngay khi bất kỳ severe feature tiến triển hoặc đến 34w

D. Chờ đến 37w

**Đáp án:** C — TSG nặng < 34w + ổn định sau corticosteroid: expectant có thể kéo dài thêm vài ngày–tuần; điều kiện: HA kiểm soát, không HELLP nặng, không suy thai; theo dõi chuyên sâu

---

## Q178

Thai phụ 34 tuổi, THA mạn + ĐTĐ type 2. Thai 30 tuần. HA 170/108 mmHg dù dùng nifedipine XR 60 mg. Protein niệu mới P/C 1,2. Tiểu cầu 170.000/μL. HbA1c 7,5%.

**Câu hỏi:** Thách thức quản lý đặc biệt ở bệnh nhân này là gì?

A. ĐTĐ không ảnh hưởng đến quản lý TSG

B. Chỉ cần kiểm soát đường huyết

C. Không cần corticosteroid vì ĐTĐ

D. Đa bệnh nền: TSG chồng ghép + ĐTĐ kiểm soát kém; corticosteroid sẽ tăng đường huyết → cần insulin chỉnh; hạ áp cấp + thêm thuốc; theo dõi retinopathy + nephropathy

**Đáp án:** D — THA mạn + ĐTĐ + TSG: phức tạp; corticosteroid gây tăng đường → insulin sliding scale; ĐTĐ tăng nguy cơ TSG + macrosomia + stillbirth; quản lý đa chuyên khoa

---

## Q179

Sản phụ 29 tuổi, 5 ngày sau mổ lấy thai vì TSG nặng. Đột ngột khó thở, SpO₂ 82%. HA 148/95 mmHg. JVP đầy. Ran ẩm 2 phổi. EF 25% trên echocardiography cấp cứu.

**Câu hỏi:** Chẩn đoán và xử trí cấp cứu phù hợp nhất là gì?

A. Phù phổi do quá tải dịch — furosemide là đủ

B. Thuyên tắc phổi — kháng đông

C. PPCM (bệnh cơ tim chu sinh) với suy tim cấp; xử trí: oxy + furosemide IV + vasodilator (NTG) + transfer ICU; hậu sản: ACEi + β-blocker; cân nhắc bromocriptine

**Đáp án:** C — PPCM: EF 25% + suy tim cấp hậu sản; TSG tăng nguy cơ 4×; cấp cứu: lợi tiểu + giãn mạch + ICU; dài hạn: ACEi + β-blocker; EF < 30%: cân nhắc MCS/transplant nếu không hồi phục

---

## Q180

Thai phụ 33 tuổi, lupus (SLE) + APS. Thai 28 tuần. Đang dùng hydroxychloroquine + aspirin 150 mg + LMWH. HA 158/102 mmHg. Protein niệu P/C 0,9. Anti-dsDNA tăng. C3/C4 giảm. Tiểu cầu 105.000/μL.

**Câu hỏi:** Thách thức chẩn đoán phân biệt chính là gì?

A. Không cần phân biệt — điều trị giống nhau

B. Phân biệt flare lupus nephritis vs TSG chồng ghép: cả hai có protein niệu + THA; flare: anti-dsDNA↑ + C3/C4↓ + cặn niệu hoạt động; TSG: sFlt-1/PlGF↑; thường chồng lấp → cần cả hai hướng điều trị

C. Lupus bảo vệ khỏi TSG

D. Chỉ cần tăng liều corticosteroid

**Đáp án:** B — SLE + APS: nguy cơ TSG rất cao; DDx flare vs TSG: anti-dsDNA + complement + cặn niệu (flare) vs sFlt-1/PlGF (TSG); thường đồng thời → điều trị cả hai: immunosuppression + chấm dứt thai kỳ nếu cần

---

## Q181

Thai phụ 30 tuổi, TSG nặng tuần 31. HA 172/110 mmHg. MgSO₄ đang truyền. Labetalol IV 20 mg → 40 mg → 80 mg (140 mg tổng). HA vẫn 168/108 mmHg.

**Câu hỏi:** Bước tiếp theo phù hợp nhất là gì?

A. Tiếp tục labetalol đến 300 mg

B. Chấm dứt thai kỳ ngay dù chưa hạ HA

C. Thêm nifedipine 10 mg uống đồng thời với labetalol; nếu vẫn không đáp ứng → hydralazine 5 mg IV; mục tiêu HA < 160/110 trong 30–60 phút

D. Không cần hạ áp thêm — 168/108 chấp nhận được

**Đáp án:** C — Kháng trị labetalol: thêm nifedipine PO (phối hợp αβ-blocker + CCB); hydralazine hàng 3; HA 168/108 vẫn nguy hiểm (stroke risk); phải hạ < 160/110 trong 30–60′

---

## Q182

Thai phụ 28 tuổi, HELLP tuần 30. Tiểu cầu 35.000/μL. Đau hạ sườn phải dữ dội. Siêu âm: tụ máu dưới bao gan 8 cm. HA 160/105 mmHg. Hb ổn.

**Câu hỏi:** Xử trí tụ máu gan chưa vỡ phù hợp nhất là gì?

A. Mổ cấp cứu giải áp ngay

B. Theo dõi bảo tồn: hạ áp + truyền TC + theo dõi Hb/siêu âm liên tục + chuẩn bị mổ khẩn nếu vỡ; chấm dứt thai kỳ sớm

C. Chỉ cần giảm đau

D. Truyền FFP là đủ

**Đáp án:** B — Tụ máu bao gan chưa vỡ: bảo tồn nếu huyết động ổn; kiểm soát HA + bù TC/máu; siêu âm/CT serial; vỡ → mổ khẩn (packing + embolization); chấm dứt thai kỳ giúp HELLP hồi phục

---

## Q183

Thai phụ 32 tuổi, TSG nặng tuần 28. Siêu âm: thai 650g, < BPV 3, reversed EDF động mạch rốn. Nước ối ít. HA 155/100 mmHg kiểm soát được.

**Câu hỏi:** Quyết định phù hợp nhất là gì?

A. Expectant vì mới 28 tuần

B. Chỉ cần corticosteroid và chờ

C. Reversed EDF = thiếu máu rau nặng, nguy cơ thai chết cao; corticosteroid + chấm dứt thai kỳ trong 24–48h; thông báo gia đình về tiên lượng sơ sinh

D. Chuyển tuyến và chờ đến 34 tuần

**Đáp án:** C — Reversed EDF: tiên lượng rất xấu; tử vong thai 50–70% nếu không can thiệp; corticosteroid + chấm dứt 24–48h; NICU cần chuẩn bị; tư vấn gia đình về nguy cơ + lợi ích

---

## Q184

Thai phụ 27 tuổi, TSG nặng tuần 32. Sau khởi phát chuyển dạ: CTG cho thấy late decelerations lặp lại, variability giảm. Tử cung mở 4 cm.

**Câu hỏi:** Quyết định sản khoa phù hợp nhất là gì?

A. Tiếp tục theo dõi và chờ sinh thường

B. Mổ lấy thai cấp cứu — late decelerations lặp lại + giảm variability = Category III CTG = suy thai cấp; không chờ mở hết

C. Bấm ối + đặt điện cực da đầu thai

D. Giảm oxytocin và chờ

**Đáp án:** B — Category III CTG (late decels lặp lại + minimal variability): suy thai cấp; trong TSG nặng: mổ cấp cứu; không chờ sinh đường âm đạo; resuscitate intrauterine (nghiêng trái, dịch, ngưng oxytocin) trong khi chuẩn bị mổ

---

## Q185

Thai phụ 30 tuổi, TSG nặng tuần 33. HA 165/108 mmHg. Đau đầu dữ dội. MgSO₄ loading 4g IV/20′ đã tiêm. 30 phút sau: cơn co giật lần 2. Mg²⁺ máu: 5,2 mg/dL.

**Câu hỏi:** Xử trí co giật tái phát dù đang dùng MgSO₄ là gì?

A. Ngừng MgSO₄ vì không hiệu quả → phenytoin

B. Diazepam 10 mg IV thay thế

C. Không làm gì — chờ cơn giật tự hết

D. Bolus MgSO₄ thêm 2g IV/5′ (Mg 5,2 = chưa đạt therapeutic 4,8–8,4); nếu vẫn giật lần 3: midazolam hoặc thiopental; loại trừ ICH bằng CT

**Đáp án:** D — Eclampsia refractory: Mg 5,2 chưa đạt ngưỡng điều trị (4,8–8,4) → bolus thêm 2g; nếu vẫn giật dù Mg đủ: midazolam/thiopental + CT loại trừ ICH; đặt NKQ nếu cần

---

## Q186

Thai phụ 35 tuổi, ĐTĐ thai kỳ + THA thai kỳ. Tuần 36. HA 152/96 mmHg. Protein niệu âm tính. HbA1c 6,8%. Siêu âm: thai 3800g, AFI 28 cm.

**Câu hỏi:** Xử trí phù hợp nhất cho bệnh nhân này là gì?

A. Chờ sinh tự nhiên đến 40 tuần

B. Chỉ cần kiểm soát đường huyết

C. THA thai kỳ + ĐTĐTK: không có severe features → hạ áp + kiểm soát glucose; thai lớn + đa ối → nguy cơ dystocia; chấm dứt 37–38w; theo dõi TSG chuyển

D. Mổ lấy thai ngay vì thai to

**Đáp án:** C — THA thai kỳ không TSG: chấm dứt 37w (ACOG); ĐTĐTK + macrosomia + polyhydramnios: nguy cơ shoulder dystocia → cân nhắc cách sinh; theo dõi chuyển TSG (protein niệu mới, CLS)

---

## Q187

Sản phụ 31 tuổi, 10 ngày sau sinh. Tiền căn TSG nặng. HA 165/105 mmHg tái phát sau khi ngưng nifedipine 5 ngày trước. Đau đầu. Không co giật.

**Câu hỏi:** Xử trí THA hậu sản muộn phù hợp nhất là gì?

A. Không cần can thiệp — sẽ tự hết

B. Bắt đầu lại thuốc hạ áp (nifedipine hoặc labetalol) + theo dõi sát; MgSO₄ nếu đau đầu nặng/nghi eclampsia hậu sản; loại trừ PRES/CSVT nếu triệu chứng thần kinh

C. Chỉ cần paracetamol giảm đau đầu

D. Enalapril ngay — không cần lo MgSO₄

**Đáp án:** B — THA hậu sản muộn: thường xảy ra ngày 3–10; ngưng thuốc quá sớm → rebound; đau đầu + HA cao → cần MgSO₄ dự phòng eclampsia hậu sản; loại trừ bệnh lý não

---

## Q188

Thai phụ 26 tuổi, TSG nặng tuần 25. sFlt-1/PlGF > 200. Thai FGR nặng (< BPV 1). Bác sĩ hội chẩn đa chuyên khoa.

**Câu hỏi:** Yếu tố nào ảnh hưởng quyết định expectant vs chấm dứt ở tuổi thai ranh giới (24–26 tuần)?

A. Chỉ dựa vào tuổi thai

B. Chỉ dựa vào HA mẹ

C. Đa yếu tố: tình trạng mẹ (ổn định?), khả năng sống sơ sinh (NICU có?), cân nặng thai (ước lượng), Doppler, nguyện vọng gia đình; quyết định cá thể hóa

D. Luôn chấm dứt trước 26 tuần

**Đáp án:** C — 24–26w: vùng xám; quyết định cần đa chuyên khoa (sản + sơ sinh + gây mê); cân nhắc: biến chứng mẹ vs khả năng sống thai; NICU level III bắt buộc; tư vấn gia đình về tất cả kịch bản

---

## Q189

Thai phụ 29 tuổi, TSG nặng tuần 32. Đã được betamethasone 2 liều. HA ổn 148/94 mmHg. Tiểu cầu 105.000/μL. AST 45 U/L. MgSO₄ đang truyền 1g/h. Phản xạ gối hiện diện. Nhịp thở 16/phút. Nước tiểu 40 mL/h.

**Câu hỏi:** Đánh giá tình trạng MgSO₄ hiện tại và quyết định phù hợp nhất là gì?

A. Ngừng MgSO₄ vì không còn cần thiết

B. Tăng liều MgSO₄ lên 2 g/h

C. Giảm liều vì nghi ngộ độc

D. MgSO₄ an toàn: reflex (+), RR 16 (> 12), UO 40 mL/h (> 25); duy trì liều hiện tại 1 g/h; tiếp tục theo dõi 3 thông số mỗi 1–2h

**Đáp án:** D — MgSO₄ monitoring an toàn: reflex (+) = Mg < 7; RR > 12 = không suy hô hấp; UO > 25 mL/h = thải Mg tốt; duy trì liều; không cần đo Mg máu nếu clinical OK

---

## Q190

Thai phụ 33 tuổi, APS (triple positive). Thai 16 tuần. Đang dùng aspirin 150 mg + LMWH. HA 130/82 mmHg. Tiểu cầu 195.000/μL.

**Câu hỏi:** Nguy cơ đặc biệt và kế hoạch theo dõi cho bệnh nhân này là gì?

A. APS không tăng nguy cơ TSG

B. APS triple positive: nguy cơ TSG sớm rất cao (OR 9–20); aspirin + LMWH (dự phòng huyết khối + sẩy); theo dõi Doppler ĐM tử cung từ 20w; sFlt-1/PlGF từ 24w; sẵn sàng chấm dứt sớm

C. LMWH dự phòng TSG

D. Chỉ cần aspirin là đủ

**Đáp án:** B — APS triple positive: nguy cơ TSG cực cao; aspirin + LMWH (dự phòng huyết khối, không phải dự phòng TSG); theo dõi chuyên sâu; hydroxychloroquine có thể bổ sung (giảm flare + biến chứng sản khoa)

---

## Q191

Thai phụ 28 tuổi, TSG nặng tuần 34. Bishop score 3. Tiểu cầu 78.000/μL. HA 162/106 mmHg. Quyết định mổ lấy thai.

**Câu hỏi:** Kế hoạch vô cảm và hồi sức phù hợp nhất là gì?

A. Gây tê tủy sống — TC 78k đủ an toàn

B. Gây tê ngoài màng cứng

C. Gây mê toàn thân KHÔNG cần chuẩn bị TC

D. TC 78k: vùng xám (70–80k); gây tê tủy sống có thể cân nhắc nếu TC ổn và xu hướng không giảm; gây mê nếu TC giảm nhanh; truyền TC trước mổ nếu cần; quyết định cá thể hóa với gây mê

**Đáp án:** D — TC 78k: borderline; thảo luận với gây mê: nếu TC ổn + xu hướng không giảm → spinal có thể; TC giảm nhanh → GA; truyền TC mục tiêu > 50k trước mổ

---

## Q192

Thai phụ 30 tuổi, TSG nặng tuần 29. Betamethasone đang cho. 24h sau: tiểu cầu giảm từ 95.000 → 55.000/μL. AST tăng từ 80 → 250 U/L. LDH 1100 U/L.

**Câu hỏi:** Quyết định phù hợp nhất là gì?

A. Tiếp tục expectant đủ 48h corticosteroid

B. Chấm dứt thai kỳ ngay — HELLP tiến triển nhanh (TC giảm > 40% + AST tăng > 3×); corticosteroid đã cho 24h có hiệu quả một phần; không trì hoãn thêm

C. Tăng liều dexamethasone cho HELLP

D. Thêm thuốc hạ áp là đủ

**Đáp án:** B — HELLP tiến triển nhanh: chỉ định chấm dứt ngay bất kể corticosteroid chưa đủ; betamethasone 24h có hiệu quả một phần; TC giảm nhanh = dấu hiệu nguy hiểm (DIC, xuất huyết)

---

## Q193

Thai phụ 32 tuổi, TSG không nặng tuần 36. HA 148/94 mmHg với nifedipine. Đột ngột: HA 172/112 mmHg, đau đầu dữ dội, buồn nôn, AST 120 U/L (trước 35 U/L).

**Câu hỏi:** Đánh giá và xử trí phù hợp nhất là gì?

A. Không thay đổi quản lý — vẫn TSG không nặng

B. TSG không nặng → TSG nặng (HA ≥ 160/110 + đau đầu + AST↑); MgSO₄ + hạ áp cấp + chấm dứt thai kỳ (36w + severe features)

C. Chỉ tăng liều nifedipine

D. Theo dõi ngoại trú

**Đáp án:** B — Chuyển từ không nặng → nặng: HA ≥ 160/110 + triệu chứng + AST↑; 36w + severe features = chấm dứt; MgSO₄ dự phòng eclampsia; hạ áp cấp trong 30–60′

---

## Q194

Thai phụ 29 tuổi, HELLP tuần 30. Mổ lấy thai cấp cứu. 12h hậu sản: tiểu cầu tiếp tục giảm từ 45.000 → 28.000/μL. LDH 1800 U/L. Creatinine tăng 2,2 mg/dL.

**Câu hỏi:** Xử trí HELLP không hồi phục hậu sản phù hợp nhất là gì?

A. Chờ thêm 48h — HELLP luôn hồi phục sau sinh

B. Chỉ cần truyền tiểu cầu

C. Không có điều trị đặc hiệu cho HELLP hậu sản

D. HELLP không hồi phục 48–72h hậu sản: nghi TMA khác (aHUS, TTP); kiểm ADAMTS13 + complement + plasmapheresis thử; eculizumab nếu aHUS

**Đáp án:** D — HELLP thường hồi phục 24–72h hậu sản (TC nadir 24–48h, hồi phục ngày 4–6); nếu không hồi phục: nghi aHUS (complement-mediated TMA) hoặc TTP; ADAMTS13 + complement C3/C4; PEX + eculizumab nếu aHUS

---

## Q195

Thai phụ 27 tuổi, TSG nặng tuần 33. Hen phế quan nặng. HA 170/112 mmHg. Đã thử nifedipine 10 mg × 3 (tổng 30 mg). HA vẫn 165/108 mmHg.

**Câu hỏi:** Bước hạ áp tiếp theo phù hợp nhất là gì?

A. Labetalol IV — an toàn cho hen

B. Hydralazine 5 mg IV — hàng 2 khi chống chỉ định β-blocker và nifedipine chưa đủ; lặp lại 20 phút; thận trọng hạ áp unpredictable

C. Nitroprusside ngay

D. Enalapril IV

**Đáp án:** B — Hen nặng: chống chỉ định labetalol; nifedipine đã dùng tối đa PO cấp → hydralazine IV là lựa chọn tiếp; nitroprusside chỉ khi thất bại tất cả

---

## Q196

Thai phụ 30 tuổi, tuần 35. HA 145/92 mmHg. Không protein niệu. Tiểu cầu 190.000/μL. AST bình thường. Đau đầu nhẹ không đổi.

**Câu hỏi:** Phân loại và quản lý phù hợp nhất là gì?

A. TSG nặng vì có đau đầu

B. THA thai kỳ (HA ≥ 140/90 không protein niệu); hạ áp mục tiêu < 140/90; chấm dứt 37w nếu ổn; theo dõi chuyển TSG (CLS + protein niệu hàng tuần)

C. THA mạn — không cần theo dõi

D. TSG không nặng — chấm dứt ngay

**Đáp án:** B — THA thai kỳ: HA ≥ 140/90 sau 20w không protein niệu/severe features; đau đầu nhẹ không đổi không đủ chẩn đoán TSG; 15–25% THA thai kỳ sẽ tiến triển TSG → theo dõi

---

## Q197

Thai phụ 34 tuổi, CKD giai đoạn 2 (creatinine 1,2 mg/dL). APS. Thai 22 tuần. HA 148/96 mmHg. Protein niệu tăng từ 300 → 1200 mg/24h. sFlt-1/PlGF = 55.

**Câu hỏi:** Quyết định quản lý phù hợp nhất là gì?

A. Chấm dứt thai kỳ ngay — sFlt-1/PlGF > 38

B. Không có TSG — chỉ CKD tiến triển

C. sFlt-1/PlGF 55 (gray zone 38–85): nghi TSG chồng ghép nhưng chưa xác định; tăng cường theo dõi + lặp lại sFlt-1/PlGF 1–2 tuần; hạ áp tích cực; aspirin tiếp tục; corticosteroid nếu tình trạng xấu

D. Expectant không cần theo dõi thêm

**Đáp án:** C — sFlt-1/PlGF 38–85: không rule-in cũng không rule-out; CKD + APS + protein niệu tăng: nghi TSG chồng ghép; theo dõi sát + lặp xét nghiệm; chấm dứt khi xác định TSG nặng

---

## Q198

Sản phụ 28 tuổi, 6 tuần hậu sản sau TSG nặng. HA 118/74 mmHg không thuốc. Creatinine 0,6 mg/dL. Protein niệu âm tính. Đang cho bú hoàn toàn.

**Câu hỏi:** Kế hoạch dài hạn tối ưu cho bệnh nhân này là gì?

A. Không cần theo dõi thêm — đã hồi phục hoàn toàn

B. Cho bú tiếp + kiểm tra HA/lipid/glucose hàng năm; tư vấn aspirin từ 12w cho thai kỳ sau; giảm cân nếu cần; nhận biết TSG = yếu tố nguy cơ CV suốt đời

C. Chỉ cần theo dõi khi mang thai lại

D. Bắt đầu statin dự phòng ngay

**Đáp án:** B — Hồi phục hoàn toàn ≠ hết nguy cơ; AHA: TSG = sex-specific risk factor; cho bú giảm CV risk; kiểm tra HA + metabolic hàng năm; aspirin cho thai kỳ sau; statin chỉ khi có chỉ định

---

## Q199

Thai phụ 31 tuổi, TSG nặng tuần 32. Đã sinh mổ. 48h hậu sản: HA 145/92 mmHg với labetalol. Tiểu cầu hồi phục 125.000/μL. AST 55 U/L (giảm từ 200). Bác sĩ muốn chuyển thuốc về.

**Câu hỏi:** Phác đồ thuốc hạ áp hậu sản dài hạn phù hợp nhất cho bệnh nhân đang cho bú là gì?

A. Methyldopa 500 mg × 3 — hàng 1 hậu sản

B. Atenolol 100 mg — an toàn cho bú

C. Labetalol uống hoặc nifedipine XR; có thể chuyển enalapril/captopril hậu sản (an toàn cho bú); giảm dần và ngưng khi HA ổn < 140/90 trong 1–2 tuần

D. Losartan 50 mg — an toàn hậu sản

**Đáp án:** C — Hậu sản: labetalol/nifedipine XR ưu tiên; enalapril/captopril an toàn cho bú (khác với thai kỳ); methyldopa có thể gây trầm cảm; atenolol: tích lũy trong sữa; giảm dần thuốc khi HA ổn

---

## Q200

Phụ nữ 36 tuổi, tiền căn: TSG sớm tuần 28 (thai kỳ 1) + HELLP tuần 30 (thai kỳ 2). APS được chẩn đoán sau thai kỳ 2. Muốn mang thai lần 3. BMI 32. HA 130/82 mmHg.

**Câu hỏi:** Kế hoạch quản lý toàn diện tối ưu cho thai kỳ sắp tới là gì?

A. Aspirin đơn thuần là đủ

B. Chống chỉ định mang thai

C. Chỉ cần theo dõi HA tại nhà

D. Kế hoạch đa tầng: (1) giảm BMI < 30 trước mang thai; (2) aspirin 150 mg từ 12w + LMWH (APS); (3) sàng lọc FMF TCN 1; (4) Doppler ĐM tử cung 20–24w; (5) sFlt-1/PlGF từ 24w; (6) theo dõi chuyên sâu đa chuyên khoa; (7) kế hoạch chấm dứt thai kỳ sớm

**Đáp án:** D — Nguy cơ cực cao (TSG sớm 2 lần + HELLP + APS): quản lý đa tầng từ preconception; aspirin + LMWH + HCQ; sàng lọc + monitoring chuyên sâu; sẵn sàng chấm dứt sớm; tư vấn tiên lượng thực tế`;

    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(30);

    expect(result.structuredText).toContain('<<<MCQ 1>>>');
    expect(result.structuredText).toContain('✅ A. TSG nặng + HELLP');

    expect(result.structuredText).toContain('<<<MCQ 10>>>');
    expect(result.structuredText).toContain('✅ B. Phân biệt flare lupus nephritis vs TSG chồng ghép');

    expect(result.structuredText).toContain('<<<MCQ 21>>>');
    expect(result.structuredText).toContain('✅ D. TC 78k: vùng xám');

    expect(result.structuredText).toContain('<<<MCQ 30>>>');
    expect(result.structuredText).toContain('✅ D. Kế hoạch đa tầng');
  });

  it('parses question with inline options on the same line correctly preserving question text', () => {
    const text = 'Một nữ 23 tuổi đau cổ chân sau khi tiếp đất bằng bàn chân gập lòng và xoay vào trong khi đang chơi bóng chuyền. Khám: ấn đau trước mắt cá ngoài, anterior drawer test (+). Cơ chế tổn thương phù hợp nhất cho vị trí dây chằng bị tổn thương ở bệnh nhân này là gì? A. Gập mu (dorsiflexion) + xoay trong bàn chân B. Gập lòng (plantarflexion) + xoay trong bàn chân (inversion) C. Gập lòng + xoay ngoài bàn chân (eversion) D. Gập mu + xoay ngoài bàn chân + dạng';
    const result = parseMarkdownMcqs(text);
    expect(result.mcqCount).toBe(1);
    expect(result.structuredText).toContain('Question: Một nữ 23 tuổi đau cổ chân sau khi tiếp đất bằng bàn chân gập lòng và xoay vào trong khi đang chơi bóng chuyền. Khám: ấn đau trước mắt cá ngoài, anterior drawer test (+). Cơ chế tổn thương phù hợp nhất cho vị trí dây chằng bị tổn thương ở bệnh nhân này là gì?');
    expect(result.structuredText).toContain('A. Gập mu (dorsiflexion) + xoay trong bàn chân');
    expect(result.structuredText).toContain('B. Gập lòng (plantarflexion) + xoay trong bàn chân (inversion)');
    expect(result.structuredText).toContain('C. Gập lòng + xoay ngoài bàn chân (eversion)');
    expect(result.structuredText).toContain('D. Gập mu + xoay ngoài bàn chân + dạng');
  });
});

