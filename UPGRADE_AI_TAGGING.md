# 🏥 HƯỚNG DẪN NÂNG CẤP HỆ THỐNG AI TAGGING (MEDICAL CHUYÊN KHOA)

Chào AI, tôi có các file mã nguồn của project Medical Anki Generator. Nhiệm vụ của bạn là thực hiện nâng cấp tính năng **"Phân loại chuyên khoa & Gắn Tag tự động"** một cách đồng bộ trên các file sau:

---

## 1. File `src/types.ts` (Cập nhật Interfaces)
Hãy thêm trường `tags` và `specialty` như sau:
- Trong `MCQ` và `GeneratedResponse`: Thêm `tags?: string;`
- Trong `AppSettings`: Thêm `specialty?: string;`

---

## 2. File `src/core/brain.ts` (Trái tim của hệ thống Tag)
**Bước 2.1: Thêm hằng số `SPECIALTY_TAG_PROMPTS`** (Đặt phía trước phần logic Helper Normalization):
```typescript
export const SPECIALTY_TAG_PROMPTS: Record<string, string> = {
  "Nhi_khoa": `
DANH SÁCH TAG ĐƯỢC PHÉP SỬ DỤNG (Chọn 1-3 tag đúng nhất):
- AI::Nhi_khoa::He_tieu_hoa
- AI::Nhi_khoa::He_than_tiet_nieu
- AI::Nhi_khoa::He_ho_hap
- AI::Nhi_khoa::He_tuan_hoan_tim_mach
- AI::Nhi_khoa::He_than_kinh_truyen_nhiem
- AI::Nhi_khoa::He_noi_tiet
- AI::Nhi_khoa::He_huyet_hoc
- AI::Nhi_khoa::He_so_sinh
- AI::Nhi_khoa::Nhi_khoa_tong_quat
- AI::Nhi_khoa::Hoi_suc_cap_cuu
- AI::Nhi_khoa::Tiem_chung
- AI::Nhi_khoa::Viem_phoi
- AI::Nhi_khoa::Cac_thoi_ki_tuoi_tre
- AI::Nhi_khoa::Su_tang_truong_the_chat
- AI::Nhi_khoa::Su_phat_trien_tam_than_van_dong
- AI::Nhi_khoa::Viem_cau_than
- AI::Nhi_khoa::Kho_khe
- AI::Nhi_khoa::Nhu_cau_dinh_duong_danh_gia_va_phan_loai_dinh_duong
- AI::Nhi_khoa::Thieu_vitamin
- AI::Nhi_khoa::Tieu_chay
- AI::Nhi_khoa::Hoi_chung_thieu_mau
- AI::Nhi_khoa::Hoi_chung_xuat_huyet
- AI::Nhi_khoa::Hoi_chung_than_hu
- AI::Nhi_khoa::Nhiem_trung_tieu
- AI::Nhi_khoa::Suy_tim
- AI::Nhi_khoa::Tang_huy_et_ap
- AI::Nhi_khoa::Tim_bam_sinh
- AI::Nhi_khoa::Tu_chung_fallot
- AI::Nhi_khoa::Kawasaki
- AI::Nhi_khoa::Vang_da_so_sinh
- AI::Nhi_khoa::Nhiem_khuan_so_sinh
- AI::Nhi_khoa::Co_giat
- AI::Nhi_khoa::Viem_mang_nao
- AI::Nhi_khoa::Suy_ho_hap
- AI::Nhi_khoa::Soc
- AI::Nhi_khoa::Tay_chan_mieng

QUY TẮC BẮT BUỘC:
- Trích xuất Tag vào trường "tags" (cách nhau bởi dấu phẩy).
- Nếu nội dung thẻ thuộc chủ đề nào trên đây, trả về đúng nguyên văn Tag đó.
- Nếu thẻ đặc thù khác hoặc KHÔNG chắc chắn, BẮT BUỘC trả về Tag mặc định: \`AI::Nhi_khoa::0_xac_dinh\`.
`,
  "Noi_khoa": `
DANH SÁCH TAG ĐƯỢC PHÉP SỬ DỤNG:
# Tim mạch
- AI::Noi_khoa::Tim_mach::Hoi_chung_vanh_cap
- AI::Noi_khoa::Tim_mach::Hoi_chung_vanh_man
- AI::Noi_khoa::Tim_mach::Tang_huyet_ap
- AI::Noi_khoa::Tim_mach::Suy_tim 
- AI::Noi_khoa::Tim_mach::Rung_nhi
# Tiêu hoá
- AI::Noi_khoa::Tieu_hoa::Viem_tuy_cap
- AI::Noi_khoa::Tieu_hoa::Xuat_huyet_tieu_hoa_tren 
- AI::Noi_khoa::Tieu_hoa::Xo_gan 
# Hô hấp
- AI::Noi_khoa::Ho_hap::Viem_phoi 
- AI::Noi_khoa::Ho_hap::COPD
- AI::Noi_khoa::Ho_hap::Hen_phe_quan
- AI::Noi_khoa::Ho_hap::Phu_thanh_quan_do_choang_phan_ve
# Thận
- AI::Noi_khoa::Than::Ton_thuong_than_cap
- AI::Noi_khoa::Than::Benh_than_man

QUY TẮC BẮT BUỘC:
- Trích xuất Tag vào trường "tags" (cách nhau bởi dấu phẩy).
- Nếu không có trong danh sách, dùng \`AI::Noi_khoa::{He_Co_Quan}::0_xac_dinh\` hoặc \`AI::Noi_khoa::0_xac_dinh\`.
`,
  "Sinh_ly": `
DANH SÁCH TAG:
- AI::Sinh_ly::He_mau
- AI::Sinh_ly::He_tuan_hoan
- AI::Sinh_ly::He_ho_hap
- AI::Sinh_ly::He_tiet_nieu
- AI::Sinh_ly::He_tieu_hoa
- AI::Sinh_ly::He_noi_tiet
- AI::Sinh_ly::He_than_kinh

QUY TẮC: Trả về đúng nguyên văn Tag vào trường "tags". Nếu không rõ dùng \`AI::Sinh_ly::0_xac_dinh\`.
`,
  "Hoa_sinh": `
DANH SÁCH TAG:
- AI::Hoa_sinh::Chu_trinh_acid_citric_phosphoryl_hoa_oxi_hoa
- AI::Hoa_sinh::Chuyen_hoa_glucid
- AI::Hoa_sinh::Chuyen_hoa_lipid
- AI::Hoa_sinh::Chuyen_hoa_protid
- AI::Hoa_sinh::Chuyen_hoa_hemoglobin
- AI::Hoa_sinh::Chuyen_hoa_nucleotid
- AI::Hoa_sinh::Hoa_sinh_gan_mat
- AI::Hoa_sinh::Hoa_sinh_than

QUY TẮC: Trả về đúng nguyên văn Tag vào trường "tags". Nếu không rõ dùng \`AI::Hoa_sinh::0_xac_dinh\`.
`,
  "Giai_phau": `
DANH SÁCH TAG:
- AI::Giai_phau::Tim_mach::Tim
- AI::Giai_phau::Tim_mach::Dong_mach_chu_va_cac_nhanh_dong_mach_chu
- AI::Giai_phau::Co_xuong_khop::Chi_tren
- AI::Giai_phau::Co_xuong_khop::Chi_duoi
- AI::Giai_phau::Tieu_hoa::Da_day
- AI::Giai_phau::Tieu_hoa::Gan

QUY TẮC: Trả về đúng nguyên văn Tag vào trường "tags". Nếu không rõ dùng \`AI::Giai_phau::0_xac_dinh\`.
`
};
```

**Bước 2.2: Cập nhật `questionSchema` (Trong hàm `generateQuestions`)**
Thêm `tags` vào properties của schema:
```typescript
tags: { type: Type.STRING }
// Và thêm "tags" vào mảng required của item
required: ["question", "options", "correctAnswer", "explanation", "source", "difficulty", "depthAnalysis", "tags"]
```

**Bước 2.3: Inject Prompt Chuyên khoa (Trong hàm `generateQuestions`)**
Sửa logic tạo `finalInstruction`:
```typescript
let finalInstruction = settings.customPrompt 
  ? `${settings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}`
  : SYSTEM_INSTRUCTION_EXTRACT;

if (settings.specialty && SPECIALTY_TAG_PROMPTS[settings.specialty]) {
  finalInstruction += `\n\n[QUY TẮC GẮN TAG CHO CHUYÊN KHOA ${settings.specialty}]\n${SPECIALTY_TAG_PROMPTS[settings.specialty]}`;
} else {
  finalInstruction += `\n\nTrường "tags" hãy để trống hoặc điền các tag chung liên quan đến nội dung.`;
}
```

---

## 3. File `src/ui/SettingsModal.tsx` (Cập nhật Giao diện)
Hãy thêm khối `div` chọn chuyên khoa ngay sau khối chọn "Mô hình AI":
```tsx
<div>
    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
        Chuyên khoa (Gắn Tag tự động)
    </label>
    <select
        value={settings.specialty || ""}
        onChange={e => setSettings({ ...settings, specialty: e.target.value })}
        className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-white"
    >
        <option value="">Không (Mặc định)</option>
        <option value="Nhi_khoa">Nhi khoa</option>
        <option value="Noi_khoa">Nội khoa</option>
        <option value="Sinh_ly">Sinh lý</option>
        <option value="Hoa_sinh">Hóa sinh</option>
        <option value="Giai_phau">Giải phẫu</option>
    </select>
</div>
```

---

## 4. File `src/App.tsx` (Cập nhật State & Export)
**Bước 4.1: Sửa State khởi tạo `settings`**: Thêm `specialty: ''`.
**Bước 4.2: Sửa hàm `handleCopyCSV` và `downloadCSV`**:
- Thêm `"Tags"` vào `headers`.
- Thêm `esc(m.tags || "")` vào cuối mảng return của map.


---

## 5. File `src/ui/MCQDisplay.tsx` (Giao diện hiển thị & Sửa Tag)

**Bước 5.1: Hiển thị Tag trong Chế độ Review** (Tìm đoạn hiển thị `OPTIONS` và chèn vào bên dưới):

```tsx
{/* Chèn sau phần hiển thị Options trong Review Mode */}
{data.tags && (
    <div className="mt-4 flex flex-wrap gap-2 ml-14">
        {data.tags.split(',').map((tag, i) => (
            <span key={i} className="px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold rounded-lg border border-indigo-100 dark:border-indigo-800">
                #{tag.trim()}
            </span>
        ))}
    </div>
)}
```

**Bước 5.2: Hiển thị Tag trong Chế độ Soạn thảo (View Mode)** (Tìm đoạn hiển thị `difficulty/source` và chèn thêm):

```tsx
{/* Chèn thêm vào khối flex-wrap chứa Difficulty/Source */}
{mcq.tags && (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-full border border-indigo-100 dark:border-indigo-800">
        <Target size={10} className="text-indigo-500" />
        <span className="text-[9px] font-black text-indigo-600 dark:text-indigo-400 tracking-wider uppercase">Tags: {mcq.tags}</span>
    </div>
)}
```

**Bước 5.3: Thêm Ô nhập Tag trong Chế độ Sửa** (Chèn vào sau đoạn textarea `evidence`):

```tsx
{/* Thêm trường chỉnh sửa Tags */}
<div className="mt-4">
    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Thẻ phân loại (Tags - Cách nhau bởi dấu phẩy)</label>
    <input 
        type="text"
        className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 focus:ring-2 focus:ring-slate-400 text-sm font-medium"
        placeholder="AI::Chuyên_khoa::Chủ_đề, ..."
        value={data.tags || ""}
        onChange={e => onChange('tags', e.target.value)}
    />
</div>
```

---

## 6. Phụ lục: Bổ sung Full Tag Chuyên Khoan (Cho Phụ lục `brain.ts`)

Hãy thay thế hằng số `SPECIALTY_TAG_PROMPTS` bằng danh sách đầy đủ này để hệ thống mạnh mẽ hơn:

```typescript
export const SPECIALTY_TAG_PROMPTS: Record<string, string> = {
  "Nhi_khoa": "...", // (Như trên)
  "Noi_khoa": "...", // (Như trên)
  "Sinh_ly": "...", // (Như trên)
  "Hoa_sinh": "...", // (Như trên)
  "Giai_phau": "...", // (Như trên)
  // Bổ sung thêm:
  "San_phu_khoa": `
DANH SÁCH TAG: AI::San_phu_khoa::San_khoa, AI::San_phu_khoa::Phu_khoa, AI::San_phu_khoa::U_xo_tu_cung, AI::San_phu_khoa::Thai_benh_ly...
`,
  "Ngoai_khoa": `
DANH SÁCH TAG: AI::Ngoai_khoa::Ngoai_tieu_hoa, AI::Ngoai_khoa::Ngoai_chan_thuong, AI::Ngoai_khoa::Ngoai_long_nguc_tim_mach...
`,
  "Truyen_nhiem": `
DANH SÁCH TAG: AI::Truyen_nhiem::Sot_xuat_huyet, AI::Truyen_nhiem::Lao, AI::Truyen_nhiem::HIV_AIDS, AI::Truyen_nhiem::Sot_ret...
`,
  "Hoi_suc_cap_cuu": `
DANH SÁCH TAG: AI::Hoi_suc_cap_cuu::Soc, AI::Hoi_suc_cap_cuu::Suy_ho_hap, AI::Hoi_suc_cap_cuu::Ngo_doc...
`,
  "Y_hoc_co_truyen": `
DANH SÁCH TAG: AI::YHCT::Ly_luan_co_ban, AI::YHCT::Bat_cuong, AI::YHCT::Tang_phu, AI::YHCT::Kinh_lac...
`
};
```
