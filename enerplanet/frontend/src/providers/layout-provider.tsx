import React from "react";
import { query } from "@/lib/react-query";
import { ThemeProvider } from "next-themes";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, MapProvider } from "@/providers";
import { ConfirmProvider } from "@/hooks/useConfirmDialog";
import { cn } from "@/lib/utils";
interface LayoutProviderProps {
	children: React.ReactNode;
}

export const LayoutProvider: React.FC<LayoutProviderProps> = ({ children }) => {
	return (
		<QueryClientProvider client={query}>
			<AuthProvider>
				<ConfirmProvider>
					<MapProvider>
						<ThemeProvider 
							attribute="class" 
							defaultTheme="light"
							enableSystem={false}
							storageKey="theme"
							disableTransitionOnChange
						>
							<main
								className={cn(
									"h-full min-h-screen w-full",
									"bg-background text-foreground",
									"transition-colors duration-200"
								)}
							>
								{children}
							</main>
						</ThemeProvider>
						</MapProvider>
					</ConfirmProvider>
				</AuthProvider>
			</QueryClientProvider>
	);
};

