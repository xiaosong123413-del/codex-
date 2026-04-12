import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Second Brain Workspace',
  description: 'Private web workspace for the second brain knowledge base',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
