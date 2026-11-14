import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Valio Aimo | Smart assortment",
  description:
    "Find, compare and choose from the Valio Aimo catalogue. Junction 2026 independent hackathon prototype.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
