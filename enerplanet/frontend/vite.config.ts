import node_path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	resolve: {
		dedupe: ["react", "react-dom", "react-router-dom"],
		alias: {
			"@": node_path.resolve(__dirname, "src"),
			"@spatialhub/forms": node_path.resolve(__dirname, "../../libs/forms/src"),
			"@spatialhub/auth": node_path.resolve(__dirname, "../../libs/auth/src"),
			"@spatialhub/ui": node_path.resolve(__dirname, "../../libs/ui/src"),
			"@spatialhub/i18n": node_path.resolve(__dirname, "../../libs/i18n/src"),
			"react": node_path.resolve(__dirname, "node_modules/react"),
			"react-dom": node_path.resolve(__dirname, "node_modules/react-dom"),
			"react-i18next": node_path.resolve(__dirname, "../../libs/i18n/node_modules/react-i18next"),
			"i18next": node_path.resolve(__dirname, "../../libs/i18n/node_modules/i18next"),
		},
	},
	plugins: [react(), tailwindcss()],
	server: {
		port: 3000,
		proxy: {
			"/api": {
				target: "http://localhost:8000",
				changeOrigin: true,
			},
		},
	},
	define: {
		global: "globalThis",
	},
});
