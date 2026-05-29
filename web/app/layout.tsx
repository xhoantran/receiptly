import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { AgentChat } from "@/components/AgentChat";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
});
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken" });
const spline = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-spline" });

export const metadata: Metadata = {
  title: "receiptly",
  description: "Every receipt, every item — finally in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${hanken.variable} ${spline.variable}`}>
      <body
        style={
          {
            "--font-display": "var(--font-fraunces), Georgia, serif",
            "--font-body": "var(--font-hanken), system-ui, sans-serif",
            "--font-mono": "var(--font-spline), ui-monospace, monospace",
          } as React.CSSProperties
        }
      >
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0 px-6 py-8 lg:px-10">{children}</main>
          <AgentChat />
        </div>
      </body>
    </html>
  );
}
