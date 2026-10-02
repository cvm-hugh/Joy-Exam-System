import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '考试结果管理 · 六维评价',
  description: '考试结果查询系统本地管理后台',
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
