import { createRoot } from "react-dom/client";
import App from "@/App";
import "@/styles/global.css";
import { installChunkLoadRecovery } from "@/utils/chunk-recovery";

// Initialize i18n
import { initI18n } from "./index";
initI18n({ storageKey: "enerplanet_language" });

installChunkLoadRecovery();

createRoot(document.getElementById("root")!).render(<App />);
