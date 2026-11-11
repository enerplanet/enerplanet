import { createRoot } from "react-dom/client";
import App from "@/App";
import "@fontsource-variable/inter";
import "@/styles/global.css";
import { installChunkLoadRecovery } from "@/utils/chunk-recovery";

// Initialize i18n
import { initI18n } from "./index";
initI18n({ storageKey: "enerplanet_language" });

installChunkLoadRecovery();

const htmlElement = document.documentElement;
htmlElement.setAttribute("translate", "no");
htmlElement.classList.add("notranslate");

let metaTag = document.querySelector('meta[name="google"]');
if (!metaTag) {
  metaTag = document.createElement("meta");
  metaTag.setAttribute("name", "google");
  document.head.appendChild(metaTag);
}

metaTag.setAttribute("content", "notranslate");

createRoot(document.getElementById("root")!).render(<App />);
