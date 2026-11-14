import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Aimo | Your kitchen, ready",
  description:
    "Plan your lunch, find the right ingredients, and shop with Aimo. Junction 2026 design preview.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
