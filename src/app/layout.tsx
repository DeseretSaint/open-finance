import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SwRegistration } from "@/components/sw-registration";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

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
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;if(localStorage.getItem("of-dark")!=="0")d.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className={inter.variable}>
        <Providers>{children}</Providers>
        <SwRegistration />
      </body>
    </html>
  );
}
