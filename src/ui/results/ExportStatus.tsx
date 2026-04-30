interface ExportStatusProps {
  exportAction: 'downloadCsv' | 'downloadDocx';
}

const ExportStatus: React.FC<ExportStatusProps> = ({ exportAction }) => (
  <div className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm font-medium text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-300">
    {exportAction === 'downloadCsv' && 'Đang chuẩn bị file CSV...'}
    {exportAction === 'downloadDocx' && 'Đang dựng file DOCX để tải về...'}
  </div>
);

export default ExportStatus;
