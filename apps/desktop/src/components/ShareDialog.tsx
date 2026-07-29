import type { ShareEntry } from '@fixnote/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Copy,
  Link2,
  LoaderCircle,
  Mail,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WorkspaceResource } from '../domain';
import {
  inviteCollaborator,
  listSharing,
  revokeCollaborator,
} from '../lib/api';

interface ShareDialogProps {
  open: boolean;
  resource: WorkspaceResource;
  onClose: () => void;
}

export function ShareDialog({
  open,
  resource,
  onClose,
}: ShareDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  const [entries, setEntries] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void listSharing(resource.id)
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [open, resource.id]);

  async function invite() {
    if (!email.trim()) return;
    setLoading(true);
    try {
      const entry = await inviteCollaborator(resource.id, {
        email: email.trim(),
        role,
      });
      setEntries((current) => [
        ...current.filter((item) => item.email !== entry.email),
        entry,
      ]);
      setEmail('');
    } finally {
      setLoading(false);
    }
  }

  async function revoke(entry: ShareEntry) {
    await revokeCollaborator(resource.id, entry.id);
    setEntries((current) => current.filter((item) => item.id !== entry.id));
  }

  async function copyLink(entry: ShareEntry) {
    if (!entry.invitationUrl) return;
    await navigator.clipboard.writeText(entry.invitationUrl);
    setCopied(entry.id);
    window.setTimeout(() => setCopied(null), 1_400);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.section
            className="share-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Share ${resource.title}`}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 27 }}
          >
            <header>
              <div>
                <h2>Share “{resource.title}”</h2>
                <p>Invite people to this document only.</p>
              </div>
              <button onClick={onClose} aria-label="Close sharing">
                <X size={18} />
              </button>
            </header>

            <div className="share-invite-row">
              <span>
                <Mail size={16} />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void invite();
                  }}
                  placeholder="name@example.com"
                  type="email"
                />
              </span>
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as 'editor' | 'viewer')
                }
              >
                <option value="viewer">Can view</option>
                <option value="editor">Can edit</option>
              </select>
              <button
                className="invite-button"
                onClick={() => void invite()}
                disabled={loading || !email.trim()}
              >
                {loading ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  'Invite'
                )}
              </button>
            </div>

            <div className="share-list">
              <div className="share-owner">
                <span className="share-avatar owner">Y</span>
                <div>
                  <strong>You</strong>
                  <small>Owner</small>
                </div>
                <b>Owner</b>
              </div>
              {entries.map((entry) => (
                <div className="share-entry" key={entry.id}>
                  <span className="share-avatar">
                    {entry.email[0]?.toUpperCase()}
                  </span>
                  <div>
                    <strong>{entry.displayName ?? entry.email}</strong>
                    <small>
                      {entry.status === 'pending'
                        ? `Pending · ${entry.role}`
                        : entry.email}
                    </small>
                  </div>
                  {entry.invitationUrl && (
                    <button
                      onClick={() => void copyLink(entry)}
                      title="Copy invite link"
                    >
                      {copied === entry.id ? (
                        <Check size={15} />
                      ) : (
                        <Copy size={15} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => void revoke(entry)}
                    title="Revoke access"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {!loading && entries.length === 0 && (
                <div className="share-empty">
                  <Link2 size={17} />
                  Only you have access.
                </div>
              )}
            </div>
            <footer>
              <span>Editors can change content. Viewers are read-only.</span>
              <button onClick={onClose}>Done</button>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
