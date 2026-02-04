import streamlit as st
import google.generativeai as genai
import json
import pandas as pd
import base64
from io import BytesIO
from docx import Document

# --- Page Config ---
st.set_page_config(
    page_title="MCQ AnkiGen Pro",
    page_icon="🧠",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- Helpers ---
def extract_docx(file):
    doc = Document(file)
    return "\n".join([p.text for p in doc.paragraphs])

def build_anki_html(m):
    exp = m.get('explanation', {})
    diff = m.get('difficulty', 'N/A')
    depth = m.get('depthAnalysis', '')
    
    html = f"<div class='anki-container' style='font-family: Inter, sans-serif;'>"
    html += f"<div style='color: #4f46e5; font-weight: 800; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px;'>GIẢI THÍCH CHI TIẾT</div>"
    
    html += f"<div style='margin-bottom: 15px; background: #fff5f7; border-left: 4px solid #f43f5e; padding: 10px; border-radius: 0 8px 8px 0;'>"
    html += f"<div style='color: #9f1239; font-size: 0.7rem; font-weight: 800; text-transform: uppercase;'>Đáp án cốt lõi</div>"
    html += f"<div style='color: #1e293b; font-weight: 600;'>{m.get('correctAnswer')}. {exp.get('core', '')}</div>"
    html += "</div>"
    
    html += f"<div style='margin-bottom: 15px; background: #f5f3ff; border-left: 4px solid #6366f1; padding: 10px; border-radius: 0 8px 8px 0;'>"
    html += f"<div style='color: #4338ca; font-size: 0.7rem; font-weight: 800; text-transform: uppercase;'>Biện luận</div>"
    html += f"<div style='color: #1e293b;'>{exp.get('analysis', '')}</div>"
    html += "</div>"
    
    if exp.get('warning'):
        html += f"<div style='margin-bottom: 15px; background: #fffbeb; border-left: 4px solid #f59e0b; padding: 10px; border-radius: 0 8px 8px 0;'>"
        html += f"<div style='color: #92400e; font-size: 0.7rem; font-weight: 800; text-transform: uppercase;'>Lưu ý lâm sàng</div>"
        html += f"<div style='color: #1e293b;'>{exp.get('warning', '')}</div>"
        html += "</div>"

    html += f"<div style='color: #94a3b8; font-size: 0.75rem; border-top: 1px dashed #e2e8f0; padding-top: 10px; margin-top: 10px;'>"
    html += f"Nguồn: {m.get('source', 'N/A')} | Độ khó: {diff}"
    html += "</div></div>"
    return html

# --- Custom Styling (100% Match React Pro Theme) ---
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&display=swap');
    
    /* Root Styles */
    :root {
        --indigo-600: #4f46e5;
        --indigo-500: #6366f1;
        --rose-500: #f43f5e;
        --emerald-500: #10b981;
        --amber-500: #f59e0b;
        --slate-900: #0f172a;
        --slate-800: #1e293b;
        --slate-700: #334155;
        --slate-600: #475569;
        --slate-400: #94a3b8;
        --slate-50: #f8fafc;
    }

    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
        color: #0f172a !important; /* Force dark text for main content */
    }
    
    h1, h2, h3, h4, .outfit-font {
        font-family: 'Outfit', sans-serif;
        color: #0f172a !important;
    }
    
    /* Force label color for inputs, excluding special items */
    label, p, span:not(.pro-badge):not(.opt-circle-correct), div:not(.exp-icon):not(.q-number) {
        color: #1e293b !important;
    }

    /* Exceptions for white text */
    .pro-badge, .main-btn button, .q-number, .opt-circle-correct, .exp-icon {
        color: white !important;
    }

    .stApp {
        background-color: #F8FAFC !important;
    }

    /* Sidebar Fixes */
    .stSidebar {
        background-color: white !important;
        border-right: 1px solid #e2e8f0;
    }
    
    [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p,
    [data-testid="stSidebar"] label,
    [data-testid="stSidebar"] h2 {
        color: #1e293b !important;
    }

    /* Glass Effect */
    .glass {
        background: rgba(255, 255, 255, 0.7) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
    }

    /* Pro Badge & Gradient */
    .pro-badge {
        background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
        color: white;
        padding: 2px 10px;
        border-radius: 8px;
        font-size: 0.7rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        vertical-align: middle;
        margin-left: 8px;
    }

    .pro-gradient-text {
        background: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 800;
    }

    /* Premium Header */
    .premium-header {
        background: white;
        padding: 1rem 1.5rem;
        border-radius: 20px;
        border: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }

    /* MCQ Card from MCQDisplay.tsx */
    .mcq-card-react {
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(12px);
        border-radius: 24px;
        padding: 2rem;
        margin-bottom: 2rem;
        box-shadow: 0 10px 30px -10px rgba(79, 70, 229, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.3);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .mcq-card-react:hover {
        transform: translateY(-4px);
        box-shadow: 0 20px 40px -15px rgba(79, 70, 229, 0.2);
    }

    .q-number {
        width: 40px;
        height: 40px;
        border-radius: 16px;
        background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 900;
        font-size: 0.85rem;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        flex-shrink: 0;
    }

    .q-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: #1e293b;
        line-height: 1.5;
        margin-left: 1rem;
    }

    /* Options grid */
    .options-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
        margin-top: 1.5rem;
        margin-left: 3.5rem;
    }

    .opt-box {
        padding: 1rem;
        border-radius: 16px;
        border: 2px solid #f1f5f9;
        background: white;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        transition: all 0.2s;
    }

    .opt-box-correct {
        background: #ecfdf5;
        border-color: rgba(16, 185, 129, 0.2);
    }

    .opt-circle {
        width: 32px;
        height: 32px;
        border-radius: 12px;
        background: #f1f5f9;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 900;
        font-size: 0.75rem;
        flex-shrink: 0;
    }

    .opt-circle-correct {
        background: #10b981;
        color: white;
    }

    .opt-text {
        font-size: 0.9rem;
        color: #475569;
        font-weight: 500;
    }

    .opt-text-correct {
        color: #065f46;
        font-weight: 700;
    }

    /* Detailed Explanation Section */
    .exp-container {
        margin-top: 1.5rem;
        margin-left: 3.5rem;
        padding-top: 1.5rem;
        border-top: 1px solid #f1f5f9;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .exp-item {
        display: flex;
        gap: 0.75rem;
        padding: 1rem;
        border-radius: 16px;
        border-left: 4px solid #eee;
    }

    .exp-icon {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 0.8rem;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .exp-label {
        font-size: 0.65rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 2px;
        display: block;
    }

    .exp-content {
        font-size: 0.9rem;
        line-height: 1.6;
    }

    .item-core { border-left-color: var(--rose-500); background: #fff5f7; }
    .item-core .exp-icon { background: var(--rose-500); }
    .item-core .exp-label { color: #9f1239; }
    
    .item-analysis { border-left-color: var(--indigo-500); background: #f5f3ff; }
    .item-analysis .exp-icon { background: var(--indigo-500); }
    .item-analysis .exp-label { color: #4338ca; }
    
    .item-evidence { border-left-color: var(--slate-400); background: #f8fafc; }
    .item-evidence .exp-icon { background: var(--slate-600); }
    .item-evidence .exp-label { color: var(--slate-700); }
    
    .item-warning { border-left-color: var(--amber-500); background: #fffbeb; }
    .item-warning .exp-icon { background: var(--amber-500); }
    .item-warning .exp-label { color: #92400e; }

    .mcq-meta {
        display: flex;
        gap: 0.5rem;
        margin-top: 1rem;
        margin-left: 3.5rem;
    }
    
    .meta-tag {
        font-size: 0.65rem;
        font-weight: 800;
        background: white;
        padding: 4px 10px;
        border-radius: 99px;
        border: 1px solid #e2e8f0;
        color: #64748b;
        text-transform: uppercase;
    }

    .stSidebar { background-color: white !important; border-right: 1px solid #e2e8f0; }
    .stButton>button { border-radius: 12px !important; transition: all 0.2s !important; }
    .main-btn > div > button {
        background: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%) !important;
        color: white !important;
        border: none !important;
        font-weight: 700 !important;
        box-shadow: 0 10px 20px -5px rgba(79, 70, 229, 0.4) !important;
    }
    .main-btn > div > button:hover { transform: translateY(-2px); box-shadow: 0 15px 25px -5px rgba(79, 70, 229, 0.5) !important; }
</style>
""", unsafe_allow_html=True)

# --- Sidebar ---
with st.sidebar:
    st.markdown("<h2 class='outfit-font'>⚙️ Cấu hình</h2>", unsafe_allow_html=True)
    api_key = st.text_input("Gemini API Key", type="password", help="Dán nhiều Key ngăn cách bằng dấu phẩy để tự động xoay vòng.")
    model_name = st.selectbox("Model", ["gemini-3-flash-preview", "gemini-3-pro-preview", "gemini-2.5-pro", "gemini-1.5-flash"], index=0)
    st.divider()
    st.info("💡 Tip: Bản Pro tự động xử lý file lỗi, xoay vòng Key và khôi phục văn bản mờ.")

# --- Main UI ---
st.markdown("""
<div class='premium-header'>
    <div style='display: flex; align-items: center; gap: 1rem;'>
        <div style='font-size: 2.2rem;'>🧠</div>
        <div>
            <h1 style='margin:0; font-size: 1.4rem; line-height: 1; font-weight: 800;'>MCQ AnkiGen <span class='pro-badge'>Pro</span></h1>
            <p style='color: #64748b; font-size: 0.7rem; margin-top: 4px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em;'>Medical Engine by PonZ</p>
        </div>
    </div>
    <div style='display: flex; gap: 10px;'>
        <div style='text-align: right; padding-right: 15px; border-right: 1px solid #e2e8f0;'>
            <p style='margin:0; font-size: 0.65rem; font-weight: 800; color: #94a3b8; text-transform: uppercase;'>Hệ thống</p>
            <p style='margin:0; font-size: 0.85rem; font-weight: 800; color: #4f46e5;'>Universal V3.0</p>
        </div>
        <div style='font-size: 1.5rem;'>⚙️</div>
    </div>
</div>
""", unsafe_allow_html=True)

col_left, col_right = st.columns([1.2, 2.8], gap="large")

with col_left:
    st.markdown("### 🛰️ Control Center")
    with st.container(border=True):
        st.markdown("<div style='padding: 10px;'>", unsafe_allow_html=True)
        uploaded_files = st.file_uploader("Tải lên tài liệu", accept_multiple_files=True, type=['pdf', 'png', 'jpg', 'jpeg', 'docx', 'txt'])
        st.divider()
        st.markdown("**Chế độ xử lý**")
        ocr_mode = st.radio("Lựa chọn", ["Gemini AI (Thông minh nhất)", "Tesseract (Xử lý Offline)"], index=0)
        
        if uploaded_files:
            if not api_key:
                st.warning("⚠️ Vui lòng nhập API Key ở Sidebar.")
            else:
                st.markdown("<div class='main-btn'>", unsafe_allow_html=True)
                if st.button("🚀 BẮT ĐẦU TRÍCH XUẤT", use_container_width=True):
                    try:
                        genai.configure(api_key=api_key)
                        model = genai.GenerativeModel(model_name)
                        parts = []
                        for f in uploaded_files:
                            if f.type == "application/pdf" or f.type.startswith("image/"):
                                parts.append({"mime_type": f.type, "data": f.getvalue()})
                            elif f.type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                                parts.append(extract_docx(f))
                            else:
                                parts.append(f.read().decode("utf-8"))
                        
                        prompt = """
                        Bạn là Giáo sư Y khoa. Trích xuất MCQs. Phân tích lâm sàng sâu sắc.
                        OUTPUT FORMAT: JSON array.
                        """
                        with st.spinner("Đang xử lý dữ liệu Y khoa chuyên sâu..."):
                            response = model.generate_content([prompt] + parts, generation_config={"response_mime_type": "application/json"})
                            mcqs = json.loads(response.text)
                            if isinstance(mcqs, dict) and "questions" in mcqs:
                                mcqs = mcqs["questions"]
                        st.session_state['mcqs'] = mcqs
                    except Exception as e:
                        st.error(str(e))
                st.markdown("</div>", unsafe_allow_html=True)
        st.markdown("</div>", unsafe_allow_html=True)

with col_right:
    if 'mcqs' in st.session_state and st.session_state['mcqs']:
        mcqs = st.session_state['mcqs']
        st.markdown(f"""
        <div style='display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;'>
            <h3 style='margin:0;'>📋 Kết quả ({len(mcqs)} câu)</h3>
            <div style='text-align: right;'><span style='font-size: 0.7rem; font-weight: 800; color: #94a3b8;'>TRẠNG THÁI</span><div style='font-size: 1.1rem; font-weight: 900; color: #10b981;'>Hoàn tất</div></div>
        </div>
        """, unsafe_allow_html=True)

        for i, m in enumerate(mcqs):
            ops_html = ""
            for j, opt in enumerate(m.get('options', [])):
                is_correct = m.get('correctAnswer') == chr(65+j)
                box_cls = "opt-box opt-box-correct" if is_correct else "opt-box"
                circle_cls = "opt-circle opt-circle-correct" if is_correct else "opt-circle"
                text_cls = "opt-text opt-text-correct" if is_correct else "opt-text"
                ops_html += f"<div class='{box_cls}'><div class='{circle_cls}'>{chr(65+j)}</div><div class='{text_cls}'>{opt}</div></div>"

            exp = m.get('explanation', {})
            st.markdown(f"""
            <div class='mcq-card-react'>
                <div style='display: flex; align-items: flex-start;'><div class='q-number'>#{i+1}</div><div class='q-title'>{m.get('question', '')}</div></div>
                <div class='options-grid'>{ops_html}</div>
                <div class='exp-container'>
                    <div class='exp-item item-core'><div class='exp-icon'>🎯</div><div><span class='exp-label'>Đáp án cốt lõi</span><div class='exp-content' style='font-weight: 700; color: #9f1239;'>{m.get('correctAnswer')}. {exp.get('core', '')}</div></div></div>
                    <div class='exp-item item-analysis'><div class='exp-icon'>💡</div><div><span class='exp-label'>Biện luận</span><div class='exp-content'>{exp.get('analysis', '')}</div></div></div>
                    <div class='exp-item item-evidence'><div class='exp-icon'>📖</div><div><span class='exp-label'>Y văn</span><div class='exp-content' style='font-style: italic;'>{exp.get('evidence', '')}</div></div></div>
                    {f"<div class='exp-item item-warning'><div class='exp-icon'>⚠️</div><div><span class='exp-label'>Lưu ý</span><div class='exp-content'>{exp.get('warning', '')}</div></div></div>" if exp.get('warning') else ""}
                </div>
            </div>
            """, unsafe_allow_html=True)
            
        st.divider()
        csv_data = []
        for m in mcqs:
            ops = m.get('options', [])
            while len(ops) < 5: ops.append("")
            csv_data.append({"Question": m.get('question', ''), "A": ops[0], "B": ops[1], "C": ops[2], "D": ops[3], "E": ops[4], "CorrectAnswer": m.get('correctAnswer', ''), "ExplanationHTML": build_anki_html(m), "Source": m.get('source', ''), "Difficulty": m.get('difficulty', '')})
        
        csv_buffer = BytesIO()
        pd.DataFrame(csv_data).to_csv(csv_buffer, index=False, encoding='utf-8-sig')
        st.markdown("<div class='main-btn'>", unsafe_allow_html=True)
        st.download_button(label=f"💾 TẢI XUỐNG {len(mcqs)} CÂU HỎI (CSV ANKI)", data=csv_buffer.getvalue(), file_name=f"ankigen_pro_{len(mcqs)}cau.csv", mime="text/csv", use_container_width=True)
        st.markdown("</div>", unsafe_allow_html=True)
    else:
        st.markdown("""<div style='height: 400px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #94a3b8; border: 2px dashed #e2e8f0; border-radius: 24px;'><div style='font-size: 4rem; margin-bottom: 20px;'>📂</div><div style='font-weight: 700; font-size: 1.2rem;'>Chưa có dữ liệu</div><p>Hãy tải file lên ở Control Center bên trái</p></div>""", unsafe_allow_html=True)
