import React, { useMemo, useState } from 'react';
import { Archive, Download, FileText, FolderOpen, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { MCQ, ProjectComparison, StudyProject } from '../types';
import { generateCSVData } from '../hooks/useExportActions';
import { buildStudyDocxBlob } from '../core/docxExport';
import { compareProjectToCurrent, sanitizeDownloadName } from '../utils/projectLibrary';

interface ProjectLibraryModalProps {
  activeProjectId: string | null;
  currentMcqs: MCQ[];
  loading: boolean;
  onClose: () => void;
  onDeleteProject: (project: StudyProject) => Promise<void>;
  onOpenProject: (project: StudyProject) => Promise<void>;
  onRenameProject: (projectId: string, name: string) => Promise<void>;
  onSaveCurrentProject: () => Promise<void>;
  projects: StudyProject[];
  show: boolean;
}

const formatDate = (value: number) => new Date(value).toLocaleString('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const downloadBlob = (blob: Blob, filename: string) => {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const ComparisonSummary: React.FC<{ comparison: ProjectComparison }> = ({ comparison }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">
      <div className="text-lg font-black">{comparison.added.length}</div>
      <div className="text-[10px] font-black uppercase tracking-wider">Câu mới</div>
    </div>
    <div className="rounded-2xl bg-rose-50 p-3 text-rose-700 dark:bg-rose-950/25 dark:text-rose-300">
      <div className="text-lg font-black">{comparison.removed.length}</div>
      <div className="text-[10px] font-black uppercase tracking-wider">Đã mất</div>
    </div>
    <div className="rounded-2xl bg-amber-50 p-3 text-amber-700 dark:bg-amber-950/25 dark:text-amber-300">
      <div className="text-lg font-black">{comparison.changedAnswers.length}</div>
      <div className="text-[10px] font-black uppercase tracking-wider">Đổi đáp án</div>
    </div>
    <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-700 dark:bg-indigo-950/25 dark:text-indigo-300">
      <div className="text-lg font-black">{comparison.likelyDuplicates.length}</div>
      <div className="text-[10px] font-black uppercase tracking-wider">Nghi trùng</div>
    </div>
  </div>
);

const ProjectLibraryModal: React.FC<ProjectLibraryModalProps> = ({
  activeProjectId,
  currentMcqs,
  loading,
  onClose,
  onDeleteProject,
  onOpenProject,
  onRenameProject,
  onSaveCurrentProject,
  projects,
  show,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const selectedProject = projects.find(project => project.id === selectedId) || projects[0] || null;
  const comparison = useMemo(
    () => selectedProject ? compareProjectToCurrent(selectedProject, currentMcqs) : null,
    [currentMcqs, selectedProject]
  );

  React.useEffect(() => {
    if (!show) return;
    const initialProject = projects.find(project => project.id === activeProjectId) || projects[0] || null;
    setSelectedId(initialProject?.id || null);
    setRenameValue(initialProject?.name || '');
  }, [activeProjectId, projects, show]);

  React.useEffect(() => {
    setRenameValue(selectedProject?.name || '');
  }, [selectedProject?.id, selectedProject?.name]);

  if (!show) return null;

  const exportCsv = async (project: StudyProject) => {
    const csv = generateCSVData(project.mcqs);
    if (!csv) {
      toast.error('Project chưa có câu hỏi để xuất CSV.');
      return;
    }
    const filename = `[ANKI]_${sanitizeDownloadName(project.name)}_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
    toast.success('Đã xuất CSV từ thư viện.');
  };

  const exportDocx = async (project: StudyProject) => {
    if (project.mcqs.length === 0) {
      toast.error('Project chưa có câu hỏi để xuất DOCX.');
      return;
    }
    setBusyAction(`docx-${project.id}`);
    try {
      const blob = await buildStudyDocxBlob(project.mcqs, project.name);
      const filename = `[DOCX]_${sanitizeDownloadName(project.name)}_${new Date().toISOString().slice(0, 10)}.docx`;
      downloadBlob(blob, filename);
      toast.success('Đã xuất DOCX từ thư viện.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-md sm:items-center sm:p-4">
      <div className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden rounded-none border border-white/20 bg-[#F8FAFC] shadow-2xl dark:border-slate-800 dark:bg-slate-950 sm:h-[88vh] sm:rounded-[2rem]">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
              <Archive size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Thư viện bộ đề</h2>
              <p className="text-xs font-bold text-slate-400">{projects.length} project đã lưu</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl bg-slate-100 p-3 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            title="Đóng"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-sm">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-400 dark:bg-slate-900">
                <FolderOpen size={30} />
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white">Chưa có project nào</h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Sau khi trích xuất xong, app sẽ tự lưu snapshot vào đây.</p>
              {currentMcqs.length > 0 && (
                <button
                  onClick={onSaveCurrentProject}
                  className="mt-6 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-lg transition hover:bg-indigo-500"
                >
                  Lưu bộ đề hiện tại
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/60 lg:border-b-0 lg:border-r">
              <div className="space-y-3">
                {projects.map(project => {
                  const active = selectedProject?.id === project.id;
                  return (
                    <button
                      key={project.id}
                      onClick={() => setSelectedId(project.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${active ? 'border-indigo-300 bg-indigo-50 shadow-sm dark:border-indigo-800 dark:bg-indigo-950/30' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-900 dark:text-white">{project.name}</div>
                          <div className="mt-1 text-xs font-bold text-slate-400">{formatDate(project.updatedAt)}</div>
                        </div>
                        {activeProjectId === project.id && (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black uppercase text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Đang mở</span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{project.stats.questionCount} câu</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{project.stats.fileCount} file</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{project.settingsSummary.provider}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto p-5 sm:p-7">
              {selectedProject && (
                <div className="space-y-5">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Tên project</label>
                        <div className="flex gap-2">
                          <input
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                          <button
                            onClick={() => onRenameProject(selectedProject.id, renameValue)}
                            className="rounded-2xl bg-indigo-600 px-4 py-3 text-white transition hover:bg-indigo-500"
                            title="Đổi tên"
                          >
                            <Pencil size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => onOpenProject(selectedProject)}
                          disabled={loading}
                          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                        >
                          <FolderOpen size={16} /> Mở lại
                        </button>
                        <button
                          onClick={() => exportCsv(selectedProject)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-500"
                        >
                          <Download size={16} /> CSV
                        </button>
                        <button
                          onClick={() => exportDocx(selectedProject)}
                          disabled={busyAction === `docx-${selectedProject.id}`}
                          className="inline-flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-black text-sky-700 transition hover:bg-sky-100 disabled:opacity-50 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300"
                        >
                          {busyAction === `docx-${selectedProject.id}` ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />} DOCX
                        </button>
                        <button
                          onClick={() => onDeleteProject(selectedProject)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                        >
                          <Trash2 size={16} /> Xóa
                        </button>
                      </div>
                    </div>
                  </div>

                  {comparison && (
                    <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-black text-slate-900 dark:text-white">So sánh với bộ đang mở</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Dựa trên nội dung câu hỏi, đáp án và bộ lọc trùng hiện có.</p>
                        </div>
                      </div>
                      <ComparisonSummary comparison={comparison} />
                    </div>
                  )}

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="mb-3 font-black text-slate-900 dark:text-white">Thông tin nhanh</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/50">Model: <strong>{selectedProject.settingsSummary.model}</strong></div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/50">Ước tính: <strong>{selectedProject.stats.estimatedCount || 'N/A'}</strong></div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/50">Duplicate: <strong>{selectedProject.stats.duplicateCount}</strong></div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/50">Cập nhật: <strong>{formatDate(selectedProject.updatedAt)}</strong></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectLibraryModal;
