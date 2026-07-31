import { useMemo, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
} from './motion/context-menu';

interface AppContextMenuProps {
  x: number;
  y: number;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** Shared FixNote context-menu shell using beUI's pointer-origin morph. */
export function AppContextMenu({
  x,
  y,
  ariaLabel,
  onClose,
  children,
  className,
}: AppContextMenuProps) {
  const anchorPoint = useMemo(() => ({ x, y }), [x, y]);

  return (
    <ContextMenu
      open
      anchorPoint={anchorPoint}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ContextMenuContent
        ariaLabel={ariaLabel}
        className={['app-context-menu', className].filter(Boolean).join(' ')}
      >
        {children}
      </ContextMenuContent>
    </ContextMenu>
  );
}
