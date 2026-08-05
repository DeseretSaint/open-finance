import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PreAuthDark } from "@/components/pre-auth-dark";
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
  themeColor: "#0C0A09",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var B="0.3.10";var p=localStorage.getItem("of-build");if(p&&p!==B){localStorage.setItem("of-build",B);try{caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});}catch(e){}try{if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});}}catch(e){}location.reload();return;}localStorage.setItem("of-build",B);}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;var v=localStorage.getItem("of-dark");var m=localStorage.getItem("of-dark-v2");if(m==null){if(v==="0"){localStorage.setItem("of-dark","1");}localStorage.setItem("of-dark-v2","1");}var v3=localStorage.getItem("of-dark-v3");if(v3==null){if(localStorage.getItem("of-dark")==="0"){localStorage.setItem("of-dark","1");}localStorage.setItem("of-dark-v3","1");}if(localStorage.getItem("of-dark")!=="0")d.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className={inter.variable}>
        <PreAuthDark>
          <Providers>{children}</Providers>
        </PreAuthDark>
        <SwRegistration />
      </body>
    </html>
  );
}
