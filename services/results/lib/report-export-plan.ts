export type ReportExportPlan = {
  kind: 'single-pdf' | 'individual-pdfs' | 'single-zip' | 'split-zips';
  useFolderSession: boolean;
  createBatchFolder: boolean;
};

export function planReportExport(count: number, desktopFolderSupport: boolean): ReportExportPlan {
  if (count <= 1)
    return { kind: 'single-pdf', useFolderSession: false, createBatchFolder: false };
  if (count <= 5 && desktopFolderSupport)
    return { kind: 'individual-pdfs', useFolderSession: true, createBatchFolder: false };
  if (count <= 20)
    return { kind: 'single-zip', useFolderSession: false, createBatchFolder: false };
  return {
    kind: 'split-zips',
    useFolderSession: desktopFolderSupport,
    createBatchFolder: desktopFolderSupport,
  };
}

export function localExportStamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
