import type { Session } from '@supabase/supabase-js';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowLeft,
  LoaderCircle,
  Mail,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { isMockAuth, supabaseClient } from '../lib/api';
import { BrandMark } from './BrandMark';
import { AuthWindowFrame } from './WindowControls';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

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
      <AuthWindowFrame>
        <div className="auth-loading">
        <BrandMark className="brand-mark" />
        Restoring encrypted session…
        </div>
      </AuthWindowFrame>
    );
  }
  if (isMockAuth) return children;
  if (!supabaseClient) {
    return (
      <AuthWindowFrame>
        <div className="auth-loading auth-config-error">
        <BrandMark className="brand-mark" />
        <strong>Supabase is not configured</strong>
        <small>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</small>
        </div>
      </AuthWindowFrame>
    );
  }
  if (!session) {
    return (
      <AuthWindowFrame>
        <AuthScreen />
      </AuthWindowFrame>
    );
  }
  return children;
}

function AuthScreen() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<string[]>(
    Array.from({ length: OTP_LENGTH }, () => ''),
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeInputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => {
      setResendIn((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  async function sendCode() {
    const normalizedEmail = email.trim().toLocaleLowerCase();
    if (!supabaseClient || !isValidEmail(normalizedEmail)) return;
    setLoading(true);
    setMessage(null);
    const { error } = await supabaseClient.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: true,
      },
    });
    setLoading(false);
    if (error) {
      setMessage(authErrorMessage(error.message));
      return;
    }
    setEmail(normalizedEmail);
    setCode(Array.from({ length: OTP_LENGTH }, () => ''));
    setResendIn(RESEND_SECONDS);
    setStep('code');
    window.setTimeout(() => codeInputs.current[0]?.focus(), 240);
  }

  async function verifyCode() {
    const token = code.join('');
    if (!supabaseClient || token.length !== OTP_LENGTH) return;
    setLoading(true);
    setMessage(null);
    const { error } = await supabaseClient.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    setLoading(false);
    if (error) {
      setMessage(authErrorMessage(error.message));
      setCode(Array.from({ length: OTP_LENGTH }, () => ''));
      window.setTimeout(() => codeInputs.current[0]?.focus(), 0);
    }
  }

  async function resendCode() {
    if (resendIn > 0 || loading) return;
    await sendCode();
  }

  function updateCode(index: number, value: string) {
    const digits = value.replace(/\D/g, '');
    if (!digits) {
      setCode((current) =>
        current.map((digit, digitIndex) => (digitIndex === index ? '' : digit)),
      );
      return;
    }
    setCode((current) => {
      const next = [...current];
      digits
        .slice(0, OTP_LENGTH - index)
        .split('')
        .forEach((digit, offset) => {
          next[index + offset] = digit;
        });
      return next;
    });
    const nextIndex = Math.min(index + digits.length, OTP_LENGTH - 1);
    window.setTimeout(() => codeInputs.current[nextIndex]?.focus(), 0);
  }

  function handleCodeKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
  ) {
    if (event.key === 'Backspace' && !code[index] && index > 0) {
      event.preventDefault();
      setCode((current) =>
        current.map((digit, digitIndex) =>
          digitIndex === index - 1 ? '' : digit,
        ),
      );
      codeInputs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      codeInputs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      event.preventDefault();
      codeInputs.current[index + 1]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void verifyCode();
    }
  }

  function pasteCode(event: ClipboardEvent<HTMLDivElement>) {
    const digits = event.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, OTP_LENGTH);
    if (!digits) return;
    event.preventDefault();
    const next = Array.from({ length: OTP_LENGTH }, (_, index) =>
      digits[index] ?? '',
    );
    setCode(next);
    codeInputs.current[Math.min(digits.length, OTP_LENGTH) - 1]?.focus();
  }

  return (
    <div className="auth-screen">
      <motion.section
        className="auth-shell"
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <div className="auth-panel">
          <div className="auth-brand">
            <BrandMark className="brand-mark" />
            <strong>FixNote</strong>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {step === 'email' ? (
              <motion.div
                key="email"
                className="auth-step"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
              >
                <div className="auth-copy">
                  <h1>Enter your email</h1>
                  <p>We’ll send you a one-time code to continue.</p>
                </div>
                <label className="auth-field">
                  <Mail size={16} />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setMessage(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void sendCode();
                    }}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                  />
                </label>
                <AuthMessage message={message} />
                <button
                  className="auth-submit"
                  onClick={() => void sendCode()}
                  disabled={loading || !isValidEmail(email.trim())}
                >
                  {loading ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <>
                      Continue <ArrowRight size={16} />
                    </>
                  )}
                </button>
                <small className="auth-security">
                  No password. New emails create an account automatically.
                </small>
              </motion.div>
            ) : (
              <motion.div
                key="code"
                className="auth-step"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.18 }}
              >
                <button
                  className="auth-back"
                  onClick={() => {
                    setStep('email');
                    setMessage(null);
                  }}
                  aria-label="Change email"
                >
                  <ArrowLeft size={15} />
                </button>
                <div className="auth-copy">
                  <h1>Check your email</h1>
                  <p>
                    We sent a code to <strong>{email}</strong>
                  </p>
                </div>
                <div
                  className="auth-code"
                  onPaste={pasteCode}
                  aria-label="One-time code"
                  style={
                    {
                      '--auth-otp-length': OTP_LENGTH,
                    } as CSSProperties
                  }
                >
                  {code.map((digit, index) => (
                    <input
                      key={index}
                      ref={(element) => {
                        codeInputs.current[index] = element;
                      }}
                      value={digit}
                      onChange={(event) =>
                        updateCode(index, event.target.value)
                      }
                      onKeyDown={(event) =>
                        handleCodeKeyDown(event, index)
                      }
                      onFocus={(event) => event.currentTarget.select()}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      autoComplete={index === 0 ? 'one-time-code' : 'off'}
                      aria-label={`Digit ${index + 1}`}
                    />
                  ))}
                </div>
                <AuthMessage message={message} />
                <button
                  className="auth-submit"
                  onClick={() => void verifyCode()}
                  disabled={loading || code.some((digit) => !digit)}
                >
                  {loading ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    'Continue'
                  )}
                </button>
                <button
                  className="auth-resend"
                  disabled={loading || resendIn > 0}
                  onClick={() => void resendCode()}
                >
                  {resendIn > 0
                    ? `Resend in ${resendIn}s`
                    : 'Resend code'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="auth-visual" aria-hidden="true">
          <div className="auth-visual-mark">
            <BrandMark className="brand-mark" />
          </div>
          <span className="auth-visual-card one" />
          <span className="auth-visual-card two" />
          <span className="auth-visual-card three" />
        </div>
      </motion.section>
    </div>
  );
}

function AuthMessage({ message }: { message: string | null }) {
  return (
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
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function authErrorMessage(message: string): string {
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes('expired') || normalized.includes('invalid')) {
    return 'The code is invalid or has expired. Request a new one.';
  }
  if (normalized.includes('rate') || normalized.includes('seconds')) {
    return 'Please wait a moment before requesting another code.';
  }
  if (normalized.includes('email')) {
    return 'We couldn’t send the email. Check the address and try again.';
  }
  return 'Something went wrong. Please try again.';
}
