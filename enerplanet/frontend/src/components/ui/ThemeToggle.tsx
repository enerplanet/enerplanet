import React from 'react';
import { useTheme } from 'next-themes';
import { Switch, Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';

const ThemeToggle: React.FC = () => {
	const { setTheme, resolvedTheme } = useTheme();
	const [mounted, setMounted] = React.useState(false);

	// Avoid hydration mismatch
	React.useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) {
		return (
			<div className="w-10 h-6" />
		);
	}

	const isDark = resolvedTheme === 'dark';

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span>
					<Switch
						checked={isDark}
						onCheckedChange={(dark) => setTheme(dark ? 'dark' : 'light')}
						aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
					/>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
			</TooltipContent>
		</Tooltip>
	);
};

export default ThemeToggle;
