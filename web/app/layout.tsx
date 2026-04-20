import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRIBE · Brain Activity Viewer",
  description:
    "Upload a video, TRIBE v2 predicts fMRI brain responses on fsaverage5.",
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
