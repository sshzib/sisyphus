import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@sisyphus/ui/styles.css";
import "./web.css";

export const metadata: Metadata = {
  title: "Sisyphus AI",
  description: "Build, monitor, and audit work performed by your AI workforce.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
