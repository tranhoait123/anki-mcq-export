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

# --- Custom Styling (Glassmorphism & Pro Theme) ---
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Outfit:wght@400;600;800&display=swap');
    
    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
    }
    
    h1, h2, h3, .pro-badge {
        font-family: 'Outfit', sans-serif;
    }
    
    .stApp {
        background: radial-gradient(circle at top right, #f8faff, #f1f4ff);
    }
    
    /* Premium Header */
    .premium-header {
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(12px);
        padding: 1.5rem 2rem;
        border-radius: 24px;
        margin-bottom: 2.5rem;
        border: 1px solid rgba(255, 255, 255, 0.4);
        box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    
    .logo-section {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .pro-badge {
        background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
        color: white;
        padding: 2px 10px;
        border-radius: 8px;
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    /* Glass Cards */
    .glass-card {
        background: rgba(255, 255, 255, 0.65);
        backdrop-filter: blur(10px);
        padding: 2rem;
        border-radius: 24px;
        border: 1px solid rgba(255, 255, 255, 0.5);
        box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.05);
        margin-bottom: 2rem;
    }
    
    .pro-gradient-text {
        background: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 800;
    }
    
    /* MCQ Card Styling */
    .mcq-card {
        background: white;
        padding: 1.8rem;
        border-radius: 20px;
        margin-bottom: 1.5rem;
        border-left: 6px solid #6366f1;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
        transition: transform 0.2s ease;
    }
    
    .mcq-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
    }
    
    .q-text {
        font-size: 1.1rem;
        font-weight: 700;
        color: #1e293b;
        margin-bottom: 1rem;
    }
    
    .opt-item {
        padding: 0.6rem 1rem;
        border-radius: 10px;
        margin-bottom: 0.5rem;
        background: #f8fafc;
        border: 1px solid #f1f5f9;
        font-size: 0.95rem;
    }
    
    .opt-correct {
        background: #ecfdf5;
        border-color: #10b981;
        color: #065f46;
        font-weight: 600;
    }

    .explanation-box {
        background: #f8fafc;
        padding: 1.25rem;
        border-radius: 16px;
        margin-top: 1.25rem;
        border-top: 1px dashed #e2e8f0;
    }
    
    .section-title {
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #64748b;
        margin-bottom: 0.4rem;
        display: block;
    }

    .core-ans { color: #10b981; font-weight: 800; font-size: 1rem; }
    
    /* Buttons */
    .stButton>button {
        border-radius: 14px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        transition: all 0.2s;
    }
    
    .main-btn > div > button {
        background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%) !important;
        color: white !important;
        border: none !important;
        padding: 0.75rem 1rem !important;
        box-shadow: 0 10px 20px -5px rgba(99, 102, 241, 0.4) !important;
    }
    
    .main-btn > div > button:hover {
        transform: scale(1.02);
        box-shadow: 0 15px 25px -5px rgba(99, 102, 241, 0.5) !important;
    }
</style>
""", unsafe_allow_html=True)

# --- Logic Functions ---

def extract_docx(file):
    doc = Document(file)
    return "\\n".join([p.text for p in doc.paragraphs])

def build_anki_html(mcq):
    exp = mcq.get('explanation', {})
    html = f"""
    <div class='anki-card'>
        <div class='core-section'><b>Đáp án cốt lõi:</b> {exp.get('core', 'N/A')}</div>
        <hr/>
        <div class='analysis-section'><b>Biện luận:</b> {exp.get('analysis', 'N/A')}</div>
        <div class='evidence-section'><b>Bằng chứng:</b> {exp.get('evidence', 'N/A')}</div>
        <div class='warning-section' style='color: orange;'><b>Lưu ý:</b> {exp.get('warning', '')}</div>
    </div>
    """
    return html

# --- Sidebar (Settings) ---
with st.sidebar:
    st.markdown("<h2 class='pro-gradient-text'>mcq AnkiGen Pro</h2>", unsafe_allow_html=True)
    st.caption("Medical Engine by PonZ")
    st.divider()
    
    api_key = st.text_input("Gemini API Key", type="password", help="Lấy tại aistudio.google.com")
    model_name = st.selectbox("Model", ["gemini-3-flash", "gemini-3-pro", "gemini-2.5-pro", "gemini-1.5-flash"], index=0)
    
    st.divider()
    st.info("Dữ liệu của bạn được xử lý trực tiếp qua API của Google và không được lưu trữ trên server này.")

# --- Main UI ---
st.markdown("""
<div class='premium-header'>
    <div class='logo-section'>
        <div style='font-size: 2rem;'>🧠</div>
        <div>
            <h1 style='margin:0; font-size: 1.5rem; line-height: 1;'>MCQ AnkiGen <span class='pro-badge'>Pro</span></h1>
            <p style='color: #64748b; font-size: 0.75rem; margin-top: 4px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em;'>Medical Engine by PonZ</p>
        </div>
    </div>
    <div style='text-align: right;'>
        <p style='color: #64748b; font-size: 0.85rem; font-weight: 600;'>Universal Extraction System</p>
    </div>
</div>
""", unsafe_allow_html=True)

# Split Layout Control
if 'is_split' not in st.session_state:
    st.session_state['is_split'] = False

col_up, col_toggle = st.columns([4, 1])
with col_up:
    uploaded_files = st.file_uploader("Tải lên tài liệu (PDF, Ảnh, Word, Text)", accept_multiple_files=True, type=['pdf', 'png', 'jpg', 'jpeg', 'docx', 'txt'])
with col_toggle:
    st.write("Layout")
    if st.button("🔄 Toggle Split View", use_container_width=True):
        st.session_state['is_split'] = not st.session_state['is_split']

if uploaded_files:
    if not api_key:
        st.warning("⚠️ Vui lòng nhập API Key trong thanh bên để bắt đầu.")
    else:
        st.markdown("<div class='main-btn'>", unsafe_allow_html=True)
        if st.button("🚀 Bắt đầu trích xuất câu hỏi", use_container_width=True):
            try:
                genai.configure(api_key=api_key)
                model = genai.GenerativeModel(model_name)
                
                parts = []
                for f in uploaded_files:
                    if f.type == "application/pdf" or f.type.startswith("image/"):
                        parts.append({
                            "mime_type": f.type,
                            "data": f.getvalue()
                        })
                    elif f.type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                        parts.append(extract_docx(f))
                    else:
                        parts.append(f.read().decode("utf-8"))
                
                prompt = """
                Bạn là một Giáo sư Y khoa đầu ngành. Trích xuất tất cả các câu hỏi trắc nghiệm từ tài liệu này. 
                Nhiệm vụ: Phân tích sâu sắc, cung cấp biện luận lâm sàng, chẩn đoán phân biệt và trích dẫn nguồn y văn uy tín.
                
                Định dạng trả về là một JSON array:
                [
                  {
                    "question": "Câu hỏi",
                    "options": ["A", "B", "C", "D"],
                    "correctAnswer": "A",
                    "explanation": {
                      "core": "Giải thích tại sao đúng (bệnh học/lâm sàng).",
                      "analysis": "Biện luận chẩn đoán phân biệt, tại sao các câu khác sai.",
                      "evidence": "Nguồn y văn (Harrison, Nelson, Bộ Y tế...)",
                      "warning": "Lưu ý/Bẫy lâm sàng thường gặp."
                    },
                    "difficulty": "Dễ/Trung bình/Khó",
                    "source": "Tên tài liệu"
                  }
                ]
                """
                
                with st.spinner("Đang phân tích tài liệu y khoa..."):
                    response = model.generate_content([prompt] + parts, generation_config={"response_mime_type": "application/json"})
                    mcqs = json.loads(response.text)
                    
                    if isinstance(mcqs, dict) and "questions" in mcqs:
                        mcqs = mcqs["questions"]
                
                st.session_state['mcqs'] = mcqs
                st.success(f"✅ Đã trích xuất xong {len(mcqs)} câu hỏi!")
                
            except Exception as e:
                st.error(f"❌ Lỗi: {str(e)}")
        st.markdown("</div>", unsafe_allow_html=True)

# --- Display Results ---
if 'mcqs' in st.session_state and st.session_state['mcqs']:
    mcqs = st.session_state['mcqs']
    
    # Conditional Layout
    if st.session_state['is_split']:
        left_pan, right_pan = st.columns([1, 1])
    else:
        left_pan, right_pan = st.columns([2, 1])
    
    with left_pan:
        st.markdown(f"### 📋 Kết quả ({len(mcqs)} câu)")
        for i, m in enumerate(mcqs):
            opts_html = ""
            for j, opt in enumerate(m.get('options', [])):
                is_correct = m.get('correctAnswer') == chr(65+j)
                cls = "opt-item opt-correct" if is_correct else "opt-item"
                icon = "✅" if is_correct else "○"
                opts_html += f"<div class='{cls}'>{icon} {opt}</div>"

            st.markdown(f"""
            <div class='mcq-card'>
                <div class='q-text'>Câu {i+1}: {m.get('question', '')}</div>
                <div style='margin-bottom: 1rem;'>{opts_html}</div>
                <details>
                    <summary style='cursor:pointer; color:#6366f1; font-weight:700; font-size:0.85rem;'>CHI TIẾT GIẢI THÍCH</summary>
                    <div class='explanation-box'>
                        <span class='section-title'>Đáp án cốt lõi</span>
                        <p class='core-ans'>{m.get('correctAnswer')}. {m.get('explanation', {}).get('core', '')}</p>
                        
                        <span class='section-title'>Biện luận lâm sàng</span>
                        <p style='font-size:0.9rem; color:#334155;'>{m.get('explanation', {}).get('analysis', '')}</p>
                        
                        <span class='section-title'>Nguồn trích dẫn</span>
                        <p style='font-style: italic; color: #64748b; font-size:0.85rem;'>{m.get('explanation', {}).get('evidence', '')}</p>
                        
                        {f"<span class='section-title' style='color:#f59e0b;'>Lưu ý quan trọng</span><p style='color:#b45309; font-size:0.85rem;'>{m.get('explanation', {}).get('warning', '')}</p>" if m.get('explanation', {}).get('warning') else ""}
                    </div>
                </details>
            </div>
            """, unsafe_allow_html=True)
                
    with right_pan:
        st.markdown("<div class='glass-card' style='padding: 1.5rem;'>", unsafe_allow_html=True)
        st.subheader("📥 Xuất dữ liệu")
        
        # Build CSV for Anki
        csv_data = []
        for m in mcqs:
            ops = m.get('options', [])
            while len(ops) < 5: ops.append("")
            
            row = {
                "Question": m.get('question', ''),
                "A": ops[0], "B": ops[1], "C": ops[2], "D": ops[3], "E": ops[4],
                "CorrectAnswer": m.get('correctAnswer', ''),
                "ExplanationHTML": build_anki_html(m),
                "Source": m.get('source', ''),
                "Difficulty": m.get('difficulty', '')
            }
            csv_data.append(row)
            
        df = pd.DataFrame(csv_data)
        
        # Download Button
        csv_buffer = BytesIO()
        df.to_csv(csv_buffer, index=False, encoding='utf-8-sig')
        st.download_button(
            label="💾 Tải CSV chuẩn Anki",
            data=csv_buffer.getvalue(),
            file_name=f"ankigen_pro_{len(mcqs)}cau.csv",
            mime="text/csv",
            use_container_width=True
        )
        
        st.markdown("---")
        st.markdown("### 💡 Hướng dẫn Import Anki")
        st.info("1. Tải file CSV ở trên.\n2. Mở Anki -> Import File.\n3. Chọn Map các cột tương ứng (Question, A-E, Correct, Explanation).")
        st.markdown("</div>", unsafe_allow_html=True)
        
else:
    if not uploaded_files:
        st.markdown("""
        <div style='text-align: center; padding: 5rem; color: #cbd5e1;'>
            <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
            <p style='margin-top: 1rem;'>Chưa có tệp nào được chọn. Hãy tải tệp lên để bắt đầu.</p>
        </div>
        """, unsafe_allow_html=True)
