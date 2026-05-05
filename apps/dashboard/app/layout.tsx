import type { Metadata } from "next";
import { ReactNode } from "react";

import "./globals.css";
import { SessionProvider } from "../components/session-provider";

export const metadata: Metadata = {
  title: "SafeLens Dashboard",
  description: "Device pairing and feature control dashboard for SafeLens."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
