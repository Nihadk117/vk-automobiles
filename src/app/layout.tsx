import type { Metadata } from "next";
import "./globals.css";
import "./inventory-extras.css";
import "./commerce.css";
import "./part-finder.css";
import "./auth.css";

export const metadata: Metadata = {
  title: "VK AutoMobiles | Shop management",
  description: "VK AutoMobiles, Spare Parts — Edavannapara, Malappuram. Inventory, billing and accounts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
