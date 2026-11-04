"use client";
import { useState } from "react";

export default function CopyButton({ value, label = "Kopieren" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button type="button" className="btn btn--small" onClick={copy} aria-live="polite">
      {state === "ok" ? "Kopiert" : state === "fail" ? "Markieren & kopieren" : label}
    </button>
  );
}
