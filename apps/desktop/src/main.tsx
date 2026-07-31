import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div
      className="desktop-context-boundary"
      onContextMenu={(event) => event.preventDefault()}
    >
      <AuthGate>
        <App />
      </AuthGate>
    </div>
  </StrictMode>,
);
