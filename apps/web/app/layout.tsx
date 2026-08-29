import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@sisyphus/ui/styles.css";
import "./web.css";

export const metadata: Metadata = {
  title: "Sisyphus · Agent operations",
  description: "Performance, retry, and skill standing for coding agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
