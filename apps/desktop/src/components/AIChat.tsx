import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  FileText,
  PanelRightClose,
  Sparkles,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WorkspaceResource } from '../domain';
import { askAi } from '../lib/api';

export type AiProposal =
  | { type: 'create_note'; title: string }
  | { type: 'rename'; title: string };

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citationIds?: string[];
  proposal?: AiProposal;
  applied?: boolean;
}

interface AIChatProps {
  open: boolean;
  scope: WorkspaceResource | null;
  resources: WorkspaceResource[];
  onOpenChange: (open: boolean) => void;
  onOpenResource: (resourceId: string) => void;
  onApplyProposal: (proposal: AiProposal) => Promise<void>;
}

export function AIChat({
  open,
  scope,
  resources,
  onOpenChange,
  onOpenResource,
  onApplyProposal,
}: AIChatProps) {
  const [draft, setDraft] = useState('');
  const [messagesByScope, setMessagesByScope] = useState<
    Record<string, Message[]>
  >({});
  const scopeKey = scope?.id ?? 'global';
  const messages = messagesByScope[scopeKey] ?? [];

  const suggestion = useMemo(
    () =>
      scope
        ? 'Сделай краткое резюме и выдели следующие шаги'
        : 'Что я писал про поиск и релиз?',
    [scope],
  );

  function setMessages(updater: (current: Message[]) => Message[]) {
    setMessagesByScope((current) => ({
      ...current,
      [scopeKey]: updater(current[scopeKey] ?? []),
    }));
  }

  function send(text = draft) {
    const value = text.trim();
    if (!value) return;
    onOpenChange(true);
    setDraft('');

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      text: value,
    };
    setMessages((current) => [...current, userMessage]);
    const localAction = createActionResponse(value, scope);
    if (localAction) {
      window.setTimeout(() => {
        setMessages((current) => [...current, localAction]);
      }, 260);
      return;
    }

    void askAi(value, scope?.id)
      .then((response) => {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: response.answer,
            citationIds: response.citations.map(
              (citation) => citation.resourceId,
            ),
          },
        ]);
      })
      .catch(() => {
        window.setTimeout(() => {
          setMessages((current) => [
            ...current,
            createMockResponse(value, scope, resources),
          ]);
        }, 220);
      });
  }

  async function apply(message: Message) {
    if (!message.proposal) return;
    await onApplyProposal(message.proposal);
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id ? { ...item, applied: true } : item,
      ),
    );
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            className="ai-dock"
            initial={{ x: '105%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '105%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
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
              {messages.length === 0 && (
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
                  <button onClick={() => send(suggestion)}>{suggestion}</button>
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
                  {message.citationIds?.map((citationId) => (
                    <button
                      key={citationId}
                      className="citation-card"
                      onClick={() => onOpenResource(citationId)}
                    >
                      <FileText size={15} />
                      <span>
                        {resources.find(
                          (resource) => resource.id === citationId,
                        )?.title ?? 'Source note'}
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                  {message.proposal && (
                    <div className="proposal-card">
                      <div>
                        <span>Предлагаемое действие</span>
                        <strong>
                          {message.proposal.type === 'create_note'
                            ? `Создать «${message.proposal.title}»`
                            : `Переименовать в «${message.proposal.title}»`}
                        </strong>
                      </div>
                      {message.applied ? (
                        <span className="applied-label">
                          <Check size={14} /> Готово
                        </span>
                      ) : (
                        <button onClick={() => void apply(message)}>
                          Применить
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>

            <div className="ai-dock-composer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Сообщение или действие…"
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
                onClick={() => send()}
                disabled={!draft.trim()}
              >
                <ArrowUp size={17} />
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function createActionResponse(
  prompt: string,
  scope: WorkspaceResource | null,
): Message | null {
  const lower = prompt.toLocaleLowerCase('ru');
  if (/(создай|сделай).*(замет|note)/i.test(lower)) {
    const title =
      prompt.match(/[«"]([^»"]+)[»"]/)?.[1] ?? 'Новая мысль из AI-чата';
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: 'Подготовил действие. Сначала показываю его вам — данные изменятся только после подтверждения.',
      proposal: { type: 'create_note', title },
    };
  }
  if (scope && /(переимен|назови)/i.test(lower)) {
    const title = prompt.match(/[«"]([^»"]+)[»"]/)?.[1] ?? 'Новая версия';
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: 'Могу изменить название этого документа.',
      proposal: { type: 'rename', title },
    };
  }

  return null;
}

function createMockResponse(
  prompt: string,
  scope: WorkspaceResource | null,
  resources: WorkspaceResource[],
): Message {
  const lower = prompt.toLocaleLowerCase('ru');

  const citation =
    resources.find((resource) =>
      `${resource.title} ${resource.preview}`
        .toLocaleLowerCase()
        .includes(lower.split(/\s+/).find((word) => word.length > 4) ?? ''),
    ) ?? resources[0];

  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    text: scope
      ? 'Главная мысль уже сформулирована хорошо. Я бы вынес первый абзац в тезис, затем добавил короткий список следующих шагов. Изменения могу предложить отдельной карточкой.'
      : 'В заметках повторяется идея, что поиск должен ощущаться как воспоминание: гибридный retrieval находит точные слова и смысловые связи, а ответ всегда возвращает ссылку на источник.',
    ...(citation ? { citationIds: [citation.id] } : {}),
  };
}
