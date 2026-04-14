import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
	darkMode: 'class',
	content: [
		'./index.html',
		'./src/**/*.{js,ts,jsx,tsx}',
		// Include shared libraries - both src and dist for development
		'../../libs/forms/src/**/*.{js,ts,jsx,tsx}',
		'../../libs/forms/dist/**/*.{js,ts,jsx,tsx}',
		'../../libs/auth/src/**/*.{js,ts,jsx,tsx}',
		'../../libs/auth/dist/**/*.{js,ts,jsx,tsx}',
		'../../libs/ui/src/**/*.{js,ts,jsx,tsx}',
		'../../libs/ui/dist/**/*.{js,ts,jsx,tsx}',
	],
	theme: {
		extend: {
			colors: {
				background: 'var(--background)',
				foreground: 'var(--foreground)',
				card: {
					DEFAULT: 'var(--card)',
					foreground: 'var(--card-foreground)',
				},
				popover: {
					DEFAULT: 'var(--popover)',
					foreground: 'var(--popover-foreground)',
				},
				primary: {
					DEFAULT: 'var(--primary)',
					foreground: 'var(--primary-foreground)',
				},
				secondary: {
					DEFAULT: 'var(--secondary)',
					foreground: 'var(--secondary-foreground)',
				},
				muted: {
					DEFAULT: 'var(--muted)',
					foreground: 'var(--muted-foreground)',
				},
				accent: {
					DEFAULT: 'var(--accent)',
					foreground: 'var(--accent-foreground)',
				},
				destructive: {
					DEFAULT: 'var(--destructive)',
				},
				border: 'var(--border)',
				input: 'var(--input)',
				ring: 'var(--ring)',
			},
			keyframes: {
				fadeInUp: {
					from: { opacity: '0', transform: 'translateY(20px)' },
					to: { opacity: '1', transform: 'translateY(0)' },
				},
				fadeInDown: {
					from: { opacity: '0', transform: 'translateY(-20px)' },
					to: { opacity: '1', transform: 'translateY(0)' },
				},
				shimmer: {
					'0%, 100%': { backgroundPosition: '0% 50%' },
					'50%': { backgroundPosition: '100% 50%' },
				},
			},
			animation: {
				fadeInUp: 'fadeInUp 0.7s ease-out both',
				fadeInDown: 'fadeInDown 0.6s ease-out both',
				shimmer: 'shimmer 3s ease-in-out infinite',
			},
		},
	},
	plugins: [typography]
};

export default config;
