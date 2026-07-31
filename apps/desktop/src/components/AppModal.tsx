import { useId, type ReactNode } from 'react';
import {
  CenterMorphModal,
  CenterMorphModalContent,
} from './motion/center-morph-modal';

interface AppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Shared FixNote modal shell based on beUI's center-morph interaction. */
export function AppModal({
  open,
  onOpenChange,
  ariaLabel,
  eyebrow,
  title,
  description,
  children,
  footer,
  className,
}: AppModalProps) {
  const descriptionId = useId();

  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={ariaLabel}
        {...(description ? { ariaDescribedBy: descriptionId } : {})}
        closeButtonLabel={`Close ${ariaLabel}`}
        className={['app-modal-surface', className].filter(Boolean).join(' ')}
        backdropClassName="app-modal-backdrop"
        overlayClassName="app-modal-overlay"
      >
        <div className="app-modal-layout">
          <header className="app-modal-header">
            <span>{eyebrow}</span>
            <h2>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </header>
          {children ? <div className="app-modal-body">{children}</div> : null}
          {footer ? <footer className="app-modal-footer">{footer}</footer> : null}
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
