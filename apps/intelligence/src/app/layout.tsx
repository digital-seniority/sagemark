import type { Metadata } from "next";
import { SERVICES } from "@sagemark/core";
import "./globals.css";

const service = SERVICES.intelligence;

export const metadata: Metadata = {
  title: `Sagemark · ${service.title}`,
  description: service.description,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
