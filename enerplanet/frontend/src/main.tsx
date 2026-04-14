import { createRoot } from "react-dom/client";
import App from "@/App";
import "@/styles/global.css";

// Initialize i18n from library
import { initI18n } from "@spatialhub/i18n";
initI18n({ storageKey: 'enerplanet_language' });

createRoot(document.getElementById("root")!).render(<App />);
