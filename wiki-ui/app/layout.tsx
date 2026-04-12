import type { ReactNode } from 'react';

export const metadata = {
  title: 'Second Brain Workspace',
  description: 'Private web workspace for the second brain knowledge base',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: 'Georgia, Times New Roman, serif' }}>{children}</body>
    </html>
  );
}
