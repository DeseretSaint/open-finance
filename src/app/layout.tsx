import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SwRegistration } from "@/components/sw-registration";

export const metadata: Metadata = {
  title: "Open Finance",
  description:
    "Self-hosted, open-source personal finance app. Bring your own Plaid keys — or track manually. Bring your own agent.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Open Finance",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#10B981",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        <SwRegistration />
      </body>
    </html>
  );
}
