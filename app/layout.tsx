import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://surmyi.tianyiwu-95.chatgpt.site'),
  title: 'surmyi — home',
  description: 'A personal home for the things that matter today.',
  openGraph: {
    type: 'website',
    url: '/',
    title: 'surmyi',
    description: 'A personal home for what matters today.',
    images: [{ url: '/og.png', width: 1729, height: 910, alt: 'surmyi — A personal home for what matters today.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'surmyi',
    description: 'A personal home for what matters today.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
