import type { Session } from '@supabase/supabase-js';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { isMockAuth, supabaseClient } from '../lib/api';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(!isMockAuth);

  useEffect(() => {
    if (isMockAuth || !supabaseClient) {
      setChecking(false);
      return;
    }
    void supabaseClient.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setChecking(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <div className="auth-loading">
        <span className="brand-mark">f</span>
        Restoring encrypted session…
      </div>
    );
  }
  if (isMockAuth) return children;
  if (!supabaseClient) {
    return (
      <div className="auth-loading auth-config-error">
        <span className="brand-mark">f</span>
        <strong>Supabase is not configured</strong>
        <small>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</small>
      </div>
    );
  }
  if (!session) return <AuthScreen />;
  return children;
}

function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!supabaseClient || !email.trim() || password.length < 6) return;
    setLoading(true);
    setMessage(null);
    const result =
      mode === 'signin'
        ? await supabaseClient.auth.signInWithPassword({
            email: email.trim(),
            password,
          })
        : await supabaseClient.auth.signUp({
            email: email.trim(),
            password,
          });
    setLoading(false);
    if (result.error) {
      setMessage(result.error.message);
    } else if (mode === 'signup' && !result.data.session) {
      setMessage('Check your email to confirm the account.');
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-ambient one" />
      <div className="auth-ambient two" />
      <motion.section
        className="auth-card"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <div className="auth-brand">
          <span className="brand-mark">f</span>
          <div>
            <strong>FixNote</strong>
            <small>Your ideas, remembered.</small>
          </div>
        </div>
        <div className="auth-copy">
          <span>
            <Sparkles size={14} /> Local-first knowledge
          </span>
          <h1>
            Think freely.
            <br />
            Keep it private.
          </h1>
          <p>
            Notes, collaborative canvases and an AI that answers from your own
            memory.
          </p>
        </div>

        <div className="auth-tabs">
          <button
            className={mode === 'signin' ? 'is-active' : ''}
            onClick={() => setMode('signin')}
          >
            Sign in
          </button>
          <button
            className={mode === 'signup' ? 'is-active' : ''}
            onClick={() => setMode('signup')}
          >
            Create account
          </button>
        </div>

        <label className="auth-field">
          <Mail size={16} />
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            autoComplete="email"
          />
        </label>
        <label className="auth-field">
          <LockKeyhole size={16} />
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            placeholder="Password"
            autoComplete={
              mode === 'signin' ? 'current-password' : 'new-password'
            }
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </label>

        <AnimatePresence mode="wait">
          {message && (
            <motion.p
              key={message}
              className="auth-message"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {message}
            </motion.p>
          )}
        </AnimatePresence>

        <button
          className="auth-submit"
          onClick={() => void submit()}
          disabled={loading || !email.trim() || password.length < 6}
        >
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <>
              {mode === 'signin' ? 'Enter FixNote' : 'Create account'}
              <ArrowRight size={16} />
            </>
          )}
        </button>
        <small className="auth-security">
          Content is encrypted before it reaches persistent storage.
        </small>
      </motion.section>
    </div>
  );
}
