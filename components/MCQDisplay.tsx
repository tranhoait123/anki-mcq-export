
import React, { useState, useMemo } from 'react';
import { MCQ, Explanation } from '../types';
import { CheckCircle2, Search, Quote, Lightbulb, AlertTriangle, Target } from 'lucide-react';

interface MCQDisplayProps {
  mcqs: MCQ[];
}

const RichExplanation: React.FC<{ exp: Explanation }> = ({ exp }) => {
  return (
    <div className="space-y-4 mt-4 text-sm">
      <div className="bg-rose-50 border-l-4 border-rose-500 p-3 rounded-r-lg">
        <div className="flex items-start">
          <Target className="w-4 h-4 text-rose-600 mr-2 mt-0.5" />
          <div><span className="font-bold text-rose-900 block">ĐÁP ÁN CỐT LÕI:</span>{exp.core}</div>
        </div>
      </div>
      
      <div className="bg-gray-50 border-l-4 border-gray-400 p-3 rounded-r-lg italic text-gray-700">
        <div className="flex items-start">
          <Quote className="w-4 h-4 text-gray-500 mr-2 mt-0.5" />
          <div><span className="font-bold text-gray-800 not-italic block">BẰNG CHỨNG TÀI LIỆU:</span>{exp.evidence}</div>
        </div>
      </div>

      <div className="bg-indigo-50 border-l-4 border-indigo-400 p-3 rounded-r-lg">
        <div className="flex items-start">
          <Lightbulb className="w-4 h-4 text-indigo-600 mr-2 mt-0.5" />
          <div><span className="font-bold text-indigo-900 block">PHÂN TÍCH SÂU:</span>{exp.analysis}</div>
        </div>
      </div>

      {exp.warning && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded-r-lg">
          <div className="flex items-start">
            <AlertTriangle className="w-4 h-4 text-amber-600 mr-2 mt-0.5" />
            <div><span className="font-bold text-amber-900 block">LƯU Ý:</span>{exp.warning}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const MCQDisplay: React.FC<MCQDisplayProps> = ({ mcqs }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => 
    mcqs.filter(m => m.question.toLowerCase().includes(searchTerm.toLowerCase())),
  [mcqs, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-xl shadow-sm border sticky top-16 z-40 flex items-center gap-4">
        <Search className="text-gray-400" size={20} />
        <input 
          type="text" 
          placeholder="Tìm nhanh..." 
          className="flex-1 bg-transparent border-none focus:ring-0 text-sm"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <div className="text-xs font-bold text-gray-400">HIỆN CÓ: {filtered.length} CÂU</div>
      </div>

      <div className="space-y-6">
        {filtered.map((mcq, idx) => (
          <div key={mcq.id} className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="font-bold text-gray-900 mb-4 flex gap-2">
              <span className="text-indigo-600">#{idx + 1}</span> {mcq.question}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
              {mcq.options.map((opt, i) => (
                <div key={i} className={`p-3 rounded-lg border text-sm ${opt === mcq.correctAnswer ? 'bg-green-50 border-green-200 font-bold text-green-700' : 'bg-gray-50'}`}>
                  {String.fromCharCode(65 + i)}. {opt}
                </div>
              ))}
            </div>
            <div className="border-t pt-4">
              <RichExplanation exp={mcq.explanation} />
              <div className="mt-4 flex gap-2 text-[10px] font-bold uppercase text-gray-400">
                <span className="bg-gray-100 px-2 py-1 rounded">ĐỘ KHÓ: {mcq.difficulty}</span>
                <span className="bg-gray-100 px-2 py-1 rounded">NGUỒN: {mcq.source}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MCQDisplay;
