import type {
  AiChatMessage,
  AiProposal as ContractAiProposal,
} from '@fixnote/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  PanelRightClose,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import type { ImportCandidate, WorkspaceResource } from '../domain';
import { candidatesFromText } from '../lib/imports';
import {
  askAi,
  decideAiProposal,
  loadAiThread,
} from '../lib/api';

export type AiProposal = ContractAiProposal;

interface AIChatProps {
  open: boolean;
  scope: WorkspaceResource | null;
  resources: WorkspaceResource[];
  onOpenChange: (open: boolean) => void;
  onOpenResource: (resourceId: string) => void;
  onApplyProposal: (proposal: AiProposal) => Promise<void>;
  onImportAndAnalyze: (
    candidates: ImportCandidate[],
  ) => Promise<WorkspaceResource[]>;
}

export function AIChat({
  open,
  scope,
  resources,
  onOpenChange,
  onOpenResource,
  onApplyProposal,
  onImportAndAnalyze,
}: AIChatProps) {
  const [draft, setDraft] = useState('');
  const [messagesByScope, setMessagesByScope] = useState<
    Record<string, AiChatMessage[]>
  >({});
  const [threadIdsByScope, setThreadIdsByScope] = useState<
    Record<string, string | null>
  >({});
  const [loadedScopes, setLoadedScopes] = useState<Record<string, boolean>>({});
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const [sendingScope, setSendingScope] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const dragDepthRef = useRef(0);
  const [errorByScope, setErrorByScope] = useState<
    Record<string, string | null>
  >({});
  const scopeKey = scope?.id ?? 'global';
  const messages = messagesByScope[scopeKey] ?? [];
  const loading = loadingScope === scopeKey;
  const sending = sendingScope === scopeKey;

  const suggestion = useMemo(
    () =>
      scope
        ? 'Сделай краткое резюме и выдели следующие шаги'
        : 'Что я писал про поиск и релиз?',
    [scope],
  );

  useEffect(() => {
    if (!open || loadedScopes[scopeKey]) return;
    let active = true;
    setLoadingScope(scopeKey);
    setErrorByScope((current) => ({ ...current, [scopeKey]: null }));

    void loadAiThread(scope?.id)
      .then((history) => {
        if (!active) return;
        setThreadIdsByScope((current) => ({
          ...current,
          [scopeKey]: history.threadId,
        }));
        setMessagesByScope((current) => ({
          ...current,
          [scopeKey]: history.messages,
        }));
        setLoadedScopes((current) => ({
          ...current,
          [scopeKey]: true,
        }));
      })
      .catch(() => {
        if (!active) return;
        setErrorByScope((current) => ({
          ...current,
          [scopeKey]:
            'Не удалось загрузить историю. Проверьте соединение и попробуйте снова.',
        }));
      })
      .finally(() => {
        if (active) setLoadingScope(null);
      });

    return () => {
      active = false;
    };
  }, [loadedScopes, open, scope?.id, scopeKey]);

  function setMessages(
    key: string,
    updater: (current: AiChatMessage[]) => AiChatMessage[],
  ) {
    setMessagesByScope((current) => ({
      ...current,
      [key]: updater(current[key] ?? []),
    }));
  }

  async function send(text = draft, resourceIdOverride?: string) {
    const value = text.trim();
    if (!value || sending || loading) return;
    const currentScopeKey = scopeKey;
    const optimisticId = crypto.randomUUID();
    const optimisticMessage: AiChatMessage = {
      id: optimisticId,
      role: 'user',
      text: value,
      citations: [],
      proposal: null,
      createdAt: new Date().toISOString(),
    };

    onOpenChange(true);
    setDraft('');
    setErrorByScope((current) => ({
      ...current,
      [currentScopeKey]: null,
    }));
    setMessages(currentScopeKey, (current) => [
      ...current,
      optimisticMessage,
    ]);
    setSendingScope(currentScopeKey);

    try {
      const response = await askAi(
        value,
        resourceIdOverride ?? scope?.id,
        threadIdsByScope[currentScopeKey] ?? undefined,
      );
      setThreadIdsByScope((current) => ({
        ...current,
        [currentScopeKey]: response.threadId,
      }));
      setLoadedScopes((current) => ({
        ...current,
        [currentScopeKey]: true,
      }));
      setMessages(currentScopeKey, (current) => [
        ...current.filter((message) => message.id !== optimisticId),
        response.userMessage,
        response.assistantMessage,
      ]);
    } catch {
      setMessages(currentScopeKey, (current) =>
        current.filter((message) => message.id !== optimisticId),
      );
      setDraft(value);
      setErrorByScope((current) => ({
        ...current,
        [currentScopeKey]:
          'Сообщение не отправилось. Текст сохранён — попробуйте ещё раз.',
      }));
    } finally {
      setSendingScope((current) =>
        current === currentScopeKey ? null : current,
      );
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDropActive(false);

    const resourceId = event.dataTransfer.getData(
      'application/x-fixnote-resource-id',
    );
    if (resourceId) {
      const resource = resources.find((candidate) => candidate.id === resourceId);
      if (resource) {
        await send(
          `Проанализируй «${resource.title}». Дай краткое резюме, ключевые идеи и следующие шаги.`,
          resource.id,
        );
      }
      return;
    }

    const candidates = candidatesFromTransfer(event.dataTransfer);
    if (!candidates.length || importing) return;
    setImporting(true);
    setErrorByScope((current) => ({ ...current, [scopeKey]: null }));
    try {
      const created = await onImportAndAnalyze(candidates);
      const firstCreated = created[0];
      if (!firstCreated) return;
      await send(buildImportAnalysisPrompt(created), firstCreated.id);
    } catch {
      setErrorByScope((current) => ({
        ...current,
        [scopeKey]:
          'Не удалось сохранить материал из drop. Исходные данные не изменены.',
      }));
    } finally {
      setImporting(false);
    }
  }

  async function apply(proposal: AiProposal) {
    if (proposal.status !== 'pending' || busyProposalId) return;
    const currentScopeKey = scopeKey;
    setBusyProposalId(proposal.id);
    setErrorByScope((current) => ({
      ...current,
      [currentScopeKey]: null,
    }));
    try {
      await onApplyProposal(proposal);
      const result = await decideAiProposal(proposal.id, 'applied');
      replaceProposal(currentScopeKey, result.proposal);
    } catch {
      setErrorByScope((current) => ({
        ...current,
        [currentScopeKey]:
          'Не удалось применить действие. Ничего дополнительно не изменено.',
      }));
    } finally {
      setBusyProposalId(null);
    }
  }

  async function reject(proposal: AiProposal) {
    if (proposal.status !== 'pending' || busyProposalId) return;
    const currentScopeKey = scopeKey;
    setBusyProposalId(proposal.id);
    try {
      const result = await decideAiProposal(proposal.id, 'rejected');
      replaceProposal(currentScopeKey, result.proposal);
    } catch {
      setErrorByScope((current) => ({
        ...current,
        [currentScopeKey]:
          'Не удалось отклонить действие. Попробуйте ещё раз.',
      }));
    } finally {
      setBusyProposalId(null);
    }
  }

  function replaceProposal(key: string, proposal: AiProposal) {
    setMessages(key, (current) =>
      current.map((message) =>
        message.proposal?.id === proposal.id
          ? { ...message, proposal }
          : message,
      ),
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="ai-dock"
          initial={{ x: '105%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '105%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          onDragEnter={(event) => {
            if (!hasChatDropPayload(event.dataTransfer)) return;
            event.preventDefault();
            dragDepthRef.current += 1;
            setDropActive(true);
          }}
          onDragOver={(event) => {
            if (!hasChatDropPayload(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={(event) => {
            if (!hasChatDropPayload(event.dataTransfer)) return;
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setDropActive(false);
          }}
          onDrop={(event) => void handleDrop(event)}
        >
          <header className="ai-dock-header">
            <div>
              <strong>FixNote AI</strong>
              <span>{scope ? scope.title : 'Все доступные заметки'}</span>
            </div>
            <button
              className="icon-button"
              onClick={() => onOpenChange(false)}
              aria-label="Close AI panel"
            >
              <PanelRightClose size={18} />
            </button>
          </header>

          <div className="ai-messages">
            {loading && (
              <div className="ai-thread-loading">
                <LoaderCircle size={17} />
                Загружаю зашифрованную историю…
              </div>
            )}

            {!loading && messages.length === 0 && (
              <div className="ai-empty">
                <div className="ai-empty-mark">
                  <Bot size={24} />
                </div>
                <h2>{scope ? 'Работаем с документом' : 'Память FixNote'}</h2>
                <p>
                  {scope
                    ? 'Могу структурировать текст, предложить правки или найти связь с другими заметками.'
                    : 'Спроси что угодно по своим заметкам или дай безопасное действие.'}
                </p>
                <button onClick={() => void send(suggestion)}>
                  {suggestion}
                </button>
              </div>
            )}

            {messages.map((message) => (
              <motion.div
                key={message.id}
                className={`ai-message ${message.role}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {message.role === 'assistant' && (
                  <span className="assistant-dot">
                    <Sparkles size={12} />
                  </span>
                )}
                <p>{message.text}</p>
                {message.citations.map((citation) => (
                  <button
                    key={`${message.id}:${citation.resourceId}:${citation.nodeId ?? ''}`}
                    className="citation-card"
                    onClick={() => onOpenResource(citation.resourceId)}
                  >
                    <FileText size={15} />
                    <span>
                      {resources.find(
                        (resource) => resource.id === citation.resourceId,
                      )?.title ?? citation.title}
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
                {message.proposal && (
                  <ProposalCard
                    proposal={message.proposal}
                    busy={busyProposalId === message.proposal.id}
                    onApply={() => void apply(message.proposal!)}
                    onReject={() => void reject(message.proposal!)}
                  />
                )}
              </motion.div>
            ))}

            {sending && (
              <div className="ai-message assistant ai-thinking">
                <span className="assistant-dot">
                  <Sparkles size={12} />
                </span>
                <span />
                <span />
                <span />
              </div>
            )}

            {errorByScope[scopeKey] && (
              <div className="ai-chat-error">{errorByScope[scopeKey]}</div>
            )}
          </div>

          <div className="ai-dock-composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="Сообщение или действие…"
              disabled={loading || sending}
            />
            {draft && (
              <button
                className="clear-draft"
                onClick={() => setDraft('')}
                aria-label="Clear"
              >
                <X size={14} />
              </button>
            )}
            <button
              className="send-button"
              onClick={() => void send()}
              disabled={!draft.trim() || loading || sending}
            >
              {sending ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ArrowUp size={17} />
              )}
            </button>
          </div>

          {dropActive && (
            <div className="ai-drop-overlay">
              <span><Upload size={23} /></span>
              <strong>Drop to save and analyze</strong>
              <small>
                FixNote will create a note first, then pass it to this chat.
              </small>
            </div>
          )}

          {importing && (
            <div className="ai-importing" role="status">
              <LoaderCircle className="spin" size={15} />
              Creating a note and preparing analysis…
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function hasChatDropPayload(dataTransfer: DataTransfer): boolean {
  return (
    dataTransfer.types.includes('application/x-fixnote-resource-id') ||
    dataTransfer.files.length > 0 ||
    dataTransfer.types.includes('Files') ||
    dataTransfer.types.includes('text/plain') ||
    dataTransfer.types.includes('text/uri-list')
  );
}

function candidatesFromTransfer(dataTransfer: DataTransfer): ImportCandidate[] {
  const files = Array.from(dataTransfer.files);
  if (files.length) {
    return files.map((file) => ({ kind: 'file', file }));
  }
  const uriList = dataTransfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .join('\n');
  return candidatesFromText(uriList || dataTransfer.getData('text/plain'));
}

function buildImportAnalysisPrompt(resources: WorkspaceResource[]): string {
  const materials = resources
    .map((resource, index) => {
      const imported = resource.imported;
      const source =
        imported?.kind === 'link'
          ? imported.url
          : imported?.kind === 'text'
            ? imported.text
            : imported?.kind === 'file' && imported.text
              ? imported.text
              : resource.preview;
      return `${index + 1}. ${resource.title}\n${source.slice(0, 12_000)}`;
    })
    .join('\n\n');
  return `Я добавил в Inbox новые материалы. Проанализируй их: дай краткое резюме, ключевые идеи, возможные связи и следующие шаги.\n\n${materials}`;
}

function ProposalCard({
  proposal,
  busy,
  onApply,
  onReject,
}: {
  proposal: AiProposal;
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  return (
    <div className="proposal-card">
      <div>
        <span>Предлагаемое действие</span>
        <strong>
          {proposal.type === 'create_note'
            ? `Создать «${proposal.title}»`
            : `Переименовать в «${proposal.title}»`}
        </strong>
      </div>
      {proposal.status === 'pending' ? (
        <div className="proposal-actions">
          <button
            className="proposal-reject"
            onClick={onReject}
            disabled={busy}
            aria-label="Reject action"
          >
            <X size={13} />
          </button>
          <button onClick={onApply} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={13} /> : 'Применить'}
          </button>
        </div>
      ) : (
        <span className={`proposal-status ${proposal.status}`}>
          {proposal.status === 'applied' && <Check size={14} />}
          {proposal.status === 'applied'
            ? 'Готово'
            : proposal.status === 'rejected'
              ? 'Отклонено'
              : 'Истекло'}
        </span>
      )}
    </div>
  );
}
