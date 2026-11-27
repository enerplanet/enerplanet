import React from 'react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import { Sun, Moon } from 'lucide-react';
import { Switch, Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';

const ThemeToggle: React.FC = () => {
	const { t } = useTranslation();
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
						aria-label={isDark ? t('common.theme.switchToLight', 'Switch to light mode') : t('common.theme.switchToDark', 'Switch to dark mode')}
					/>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{isDark ? t('common.theme.switchToLightTitle', 'Switch to Light Mode') : t('common.theme.switchToDarkTitle', 'Switch to Dark Mode')}
			</TooltipContent>
		</Tooltip>
	);
};

/** Icon-only sun/moon theme button, for the profile dropdown. */
export const ThemeToggleButton: React.FC = () => {
	const { t } = useTranslation();
	const { setTheme, resolvedTheme } = useTheme();
	const [mounted, setMounted] = React.useState(false);

	React.useEffect(() => {
		setMounted(true);
	}, []);

	const isDark = mounted && resolvedTheme === 'dark';

	return (
		<button
			type="button"
			onClick={() => setTheme(isDark ? 'light' : 'dark')}
			aria-label={isDark ? t('common.theme.switchToLight', 'Switch to light mode') : t('common.theme.switchToDark', 'Switch to dark mode')}
			className="flex size-11 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			{isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
		</button>
	);
};

export default ThemeToggle;