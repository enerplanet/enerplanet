import React from 'react';
import { useTheme } from 'next-themes';
import { Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';
import { Moon, Sun } from 'lucide-react';

const ThemeToggle: React.FC = () => {
	const { setTheme, resolvedTheme } = useTheme();
	const [mounted, setMounted] = React.useState(false);

	// Avoid hydration mismatch
	React.useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) {
		return (
			<div className="w-10 h-5" />
		);
	}

	const isDark = resolvedTheme === 'dark';

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					onClick={() => setTheme(isDark ? 'light' : 'dark')}
					className="relative inline-flex h-5 w-10 items-center rounded-full bg-gray-300 dark:bg-gray-600 transition-colors duration-300 ease-in-out cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
					aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
				>
					{/* Sliding thumb with icon inside */}
					<span
						className={`
							absolute h-4 w-4 rounded-full bg-white shadow-sm flex items-center justify-center
							transition-all duration-300 ease-in-out
							${isDark ? 'left-5.5' : 'left-0.5'}
						`}
						style={{ left: isDark ? '22px' : '2px' }}
					>
						{isDark ? (
							<Moon className="w-2.5 h-2.5 text-gray-600" />
						) : (
							<Sun className="w-2.5 h-2.5 text-amber-500" />
						)}
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent>
				{isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
			</TooltipContent>
		</Tooltip>
	);
};

export default ThemeToggle;
