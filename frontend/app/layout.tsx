import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { TradingProvider } from "@/lib/trading-context";
import { ThemeProvider } from "@/components/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tradio — Practice Trading",
  description: "Practice trading NSE stocks with virtual ₹1,00,000. Zero risk.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} antialiased dark`}
    >
      <body style={{ background: "var(--bg)", color: "var(--text)" }}>
        <ThemeProvider>
          <AuthProvider>
            <TradingProvider>{children}</TradingProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
