import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import type { ReactNode } from 'react';

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function withCurrentWindow(
  action: (appWindow: ReturnType<typeof getCurrentWindow>) => Promise<void>,
) {
  if (!isTauriRuntime()) return;
  void action(getCurrentWindow());
}

export function toggleNativeMaximize() {
  withCurrentWindow((appWindow) => appWindow.toggleMaximize());
}

export function NativeWindowControls() {
  if (!isTauriRuntime()) return null;

  return (
    <div className="native-window-controls" aria-label="Window controls">
      <button
        onClick={() => withCurrentWindow((appWindow) => appWindow.minimize())}
        aria-label="Minimize"
      >
        <Minus size={14} />
      </button>
      <button onClick={toggleNativeMaximize} aria-label="Maximize">
        <Square size={11} />
      </button>
      <button
        className="is-close"
        onClick={() => withCurrentWindow((appWindow) => appWindow.close())}
        aria-label="Close"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function AuthWindowFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth-window-frame">
      <header
        className="auth-native-titlebar"
        data-tauri-drag-region
        onDoubleClick={toggleNativeMaximize}
      >
        <span data-tauri-drag-region>FixNote</span>
        <NativeWindowControls />
      </header>
      <div className="auth-window-content">{children}</div>
    </div>
  );
}
