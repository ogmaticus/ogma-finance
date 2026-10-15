import type { Metadata } from "next";
export const metadata: Metadata = { title: "Финансы · личный бюджет", description: "Личный бюджет и импорт операций со скриншотов", icons: { icon: "/brand.svg" } };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) { return <html lang="ru"><body>{children}</body></html>; }
