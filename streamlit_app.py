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
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
    
    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
    }
    
    .stApp {
        background: radial-gradient(circle at top right, #f8faff, #f1f4ff);
    }
    
    .main-header {
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(10px);
        padding: 1.5rem;
        border-radius: 20px;
        margin-bottom: 2rem;
        border: 1px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
    }
    
    .glass-card {
        background: rgba(255, 255, 255, 0.6);
        backdrop-filter: blur(12px);
        padding: 2rem;
        border-radius: 24px;
        border: 1px solid rgba(255, 255, 255, 0.4);
        box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.05);
        margin-bottom: 1.5rem;
    }
    
    .pro-gradient-text {
        background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 800;
    }
    
    .mcq-card {
        background: white;
        padding: 1.5rem;
        border-radius: 16px;
        margin-bottom: 1rem;
        border-left: 5px solid #6366f1;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    
    .explanation-box {
        background: #f8fafc;
        padding: 1rem;
        border-radius: 12px;
        margin-top: 1rem;
        font-size: 0.9rem;
    }
    
    .core-ans { color: #059669; font-weight: 700; }
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
<div class='main-header'>
    <h1 style='margin:0; font-size: 1.8rem;'>🧠 Trình trích xuất <span class='pro-gradient-text'>MCQ Y Khoa</span></h1>
    <p style='color: #64748b; font-size: 0.9rem; margin-top: 0.5rem;'>Biến tài liệu PDF/Ảnh thành thẻ Anki chuyên nghiệp</p>
</div>
""", unsafe_allow_html=True)

uploaded_files = st.file_uploader("Tải lên tài liệu (PDF, Ảnh, Word, Text)", accept_multiple_files=True, type=['pdf', 'png', 'jpg', 'jpeg', 'docx', 'txt'])

if uploaded_files:
    if not api_key:
        st.warning("⚠️ Vui lòng nhập API Key trong thanh bên để bắt đầu.")
    else:
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

# --- Display Results ---
if 'mcqs' in st.session_state and st.session_state['mcqs']:
    mcqs = st.session_state['mcqs']
    
    col1, col2 = st.columns([2, 1])
    
    with col1:
        st.subheader("📋 Danh sách câu hỏi")
        for i, m in enumerate(mcqs):
            with st.container():
                st.markdown(f"""
                <div class='mcq-card'>
                    <p><b>Câu {i+1}: {m.get('question', '')}</b></p>
                    <ul style='list-style-type: none; padding-left: 0;'>
                        {' '.join([f"<li>{'●' if m.get('correctAnswer') == chr(65+j) else '○'} {opt}</li>" for j, opt in enumerate(m.get('options', []))])}
                    </ul>
                    <details>
                        <summary>Xem giải thích chi tiết</summary>
                        <div class='explanation-box'>
                            <p class='core-ans'><b>Đáp án: {m.get('correctAnswer')}</b></p>
                            <p><b>Biện luận:</b> {m.get('explanation', {}).get('analysis', '')}</p>
                            <p style='font-style: italic; color: #64748b;'><b>Nguồn:</b> {m.get('explanation', {}).get('evidence', '')}</p>
                        </div>
                    </details>
                </div>
                """, unsafe_allow_html=True)
                
    with col2:
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
        st.write("1. Tải file CSV ở trên.")
        st.write("2. Mở Anki -> Import File.")
        st.write("3. Chọn Map các cột tương ứng (Question, A, B, C, D, E, Correct, Explanation).")
        
else:
    if not uploaded_files:
        st.markdown("""
        <div style='text-align: center; padding: 5rem; color: #cbd5e1;'>
            <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
            <p style='margin-top: 1rem;'>Chưa có tệp nào được chọn. Hãy tải tệp lên để bắt đầu.</p>
        </div>
        """, unsafe_allow_html=True)
