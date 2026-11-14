import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Aimo | Agent Gateway",
  description:
    "Purchasing authority, made visible. A Junction 2026 commerce gateway.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
