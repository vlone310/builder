import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Sample host" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container">
            <a href="/">Demo Sportsbook</a>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
