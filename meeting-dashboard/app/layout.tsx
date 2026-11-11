import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeetingSchedule",
  description:
    "Book a meeting with Travis Ruiz, set availability, and manage reservations. No account required.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem("meetingschedule-theme")==="light"?"light":"dark"}catch{document.documentElement.dataset.theme="dark"}` }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
