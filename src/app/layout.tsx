import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "NEXT TAXI", template: "%s · NEXT TAXI" },
  description: "G‘uzorda taksi chaqirish xizmati: narx oldindan ma’lum, haydovchi xaritada ko‘rinadi.",
  manifest: "/manifest.webmanifest",
  applicationName: "NEXT TAXI",
  appleWebApp: { capable: true, title: "NEXT TAXI", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

// Applies the saved theme before paint to avoid a flash (driver app forces dark in its layout).
const themeScript = `try{var t=localStorage.getItem('nt-theme');if(t==='dark'||(t!=='light'&&location.pathname.indexOf('/driver')===0)){document.documentElement.classList.add('dark')}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
