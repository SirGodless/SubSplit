import type { ReactNode } from "react";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

export const metadata = { title: "SubSplit", robots: { index: false, follow: false } };
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0e0e0e" };

// Dunkel ist Standard; nur eine ausdrücklich gewählte Einstellung schaltet auf Hell. Läuft vor dem ersten Paint (kein Flackern).
const themeInit = `try{var t=localStorage.getItem("subsplit-theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
