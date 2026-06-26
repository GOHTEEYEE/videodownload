import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LUXEDOWN — The Ultimate Media Downloader",
  description:
    "Download videos from TikTok, Instagram, Facebook, YouTube and more. No watermark. High quality.",
  metadataBase: new URL(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
  openGraph: {
    title: "LUXEDOWN — The Ultimate Media Downloader",
    description:
      "Download videos from TikTok, Instagram, Facebook, YouTube and more. No watermark. High quality.",
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>{children}</body>
    </html>

  );
}

