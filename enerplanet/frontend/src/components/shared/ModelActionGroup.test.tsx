import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Eye, Trash2 } from 'lucide-react';
import ModelActionGroup from './ModelActionGroup';

vi.mock('@spatialhub/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// The built UI package resolves its own React copy, so its parts are stood in for by plain markup.
vi.mock('@spatialhub/ui', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Button = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />;
  const Hidden = () => null;
  return {
    Button, Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: Hidden,
    DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: Hidden, DropdownMenuItem: Pass,
  };
});

const view = { key: 'view', icon: Eye, tooltip: 'View Results', onClick: () => {} };
const remove = { key: 'delete', icon: Trash2, tooltip: 'Delete', onClick: () => {}, menu: true };

describe('ModelActionGroup', () => {
  it('shows menu actions behind the more actions button, not as icons', () => {
    const html = renderToStaticMarkup(<ModelActionGroup actions={[view, remove]} />);
    expect(html).toContain('aria-label="View Results"');
    expect(html).not.toContain('aria-label="Delete"');
    expect(html).toContain('aria-label="common.modelActions.moreActions"');
  });

  it('has no more actions button when no shown action is a menu action', () => {
    const html = renderToStaticMarkup(<ModelActionGroup actions={[view, { ...remove, show: false }]} />);
    expect(html).not.toContain('common.modelActions.moreActions');
  });
});
