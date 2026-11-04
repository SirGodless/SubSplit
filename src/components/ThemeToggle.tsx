"use client";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  function choose(t: "dark" | "light") {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("subsplit-theme", t);
    } catch {
      /* Speicher gesperrt: Einstellung gilt nur für diese Sitzung */
    }
  }
  return (
    <div className="seg" role="group" aria-label="Farbschema">
      <button type="button" aria-pressed={theme === "light"} onClick={() => choose("light")}>Hell</button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>Dunkel</button>
    </div>
  );
}
