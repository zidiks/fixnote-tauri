import type {
  AiChatMessage,
  AiProposal as ContractAiProposal,
} from '@fixnote/contracts';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  Bot,
  ChevronRight,
  FileText,
  LoaderCircle,
  Mic,
  Paperclip,
  PanelRightClose,
  Sparkles,
  Square,
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
  transcribeAudio,
} from '../lib/api';
import { AnimatedBadge } from './motion/animated-badge';
import { Drawer } from './motion/drawer';

export type AiProposal = ContractAiProposal;

type VoiceState = 'idle' | 'recording' | 'processing';

interface SendOptions {
  context?: string;
  contextCitations?: AiChatMessage['citations'];
  intent?: 'chat' | 'capture';
  voiceAudio?: Blob;
  voiceDuration?: number;
}

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: BrowserSpeechRecognitionResult;
  };
}

interface BrowserSpeechRecognitionErrorEvent {
  readonly error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

interface AIChatProps {
  open: boolean;
  scope: WorkspaceResource | null;
  resources: WorkspaceResource[];
  onOpenChange: (open: boolean) => void;
  onOpenResource: (resourceId: string) => void;
  onApplyProposal: (
    proposal: AiProposal,
  ) => Promise<WorkspaceResource | void>;
  onAttachVoice: (
    resourceId: string,
    audio: Blob,
    transcript: string,
    durationSeconds: number,
  ) => Promise<void>;
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
  onAttachVoice,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [errorByScope, setErrorByScope] = useState<
    Record<string, string | null>
  >({});
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const recordingDurationRef = useRef(0);
  const voiceCaptureByProposalRef = useRef<Map<string, {
    audio: Blob;
    transcript: string;
    duration: number;
  }>>(new Map());
  const voiceTimerRef = useRef<number | null>(null);
  const voiceTranscriptRef = useRef('');
  const sendVoiceOnEndRef = useRef(false);
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

  useEffect(
    () => () => {
      discardRecordingRef.current = true;
      recognitionRef.current?.abort();
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (voiceTimerRef.current !== null) {
        window.clearInterval(voiceTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) return;
    discardRecordingRef.current = true;
    sendVoiceOnEndRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    stopVoiceTimer();
    setVoiceState('idle');
    setRecordingSeconds(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({
      behavior: sending || importing ? 'smooth' : 'auto',
      block: 'end',
    });
  }, [importing, loading, messages.length, open, sending]);

  function setMessages(
    key: string,
    updater: (current: AiChatMessage[]) => AiChatMessage[],
  ) {
    setMessagesByScope((current) => ({
      ...current,
      [key]: updater(current[key] ?? []),
    }));
  }

  async function send(text = draft, options: SendOptions = {}) {
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
        scope?.id,
        threadIdsByScope[currentScopeKey] ?? undefined,
        options.context,
        options.intent,
        options.contextCitations,
      );
      if (options.voiceAudio && response.assistantMessage.proposal) {
        voiceCaptureByProposalRef.current.set(
          response.assistantMessage.proposal.id,
          {
            audio: options.voiceAudio,
            transcript: value,
            duration: Math.max(1, options.voiceDuration ?? 1),
          },
        );
      }
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

  async function startVoiceRecording() {
    if (loading || sending || voiceState !== 'idle' || draft.trim()) return;
    let permissionStream: MediaStream;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    } catch {
      setErrorByScope((current) => ({
        ...current,
        [scopeKey]:
          'Нет доступа к микрофону. Разрешите его для FixNote в настройках Windows.',
      }));
      return;
    }

    if (typeof MediaRecorder !== 'undefined') {
      startMediaRecording(permissionStream);
      return;
    }
    permissionStream.getTracks().forEach((track) => track.stop());

    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setErrorByScope((current) => ({
        ...current,
        [scopeKey]:
          'Голосовой ввод недоступен в этой версии системы. Обновите WebView2 или воспользуйтесь текстом.',
      }));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'ru-RU';
    recognitionRef.current = recognition;
    voiceTranscriptRef.current = '';
    sendVoiceOnEndRef.current = false;
    setDraft('');
    setRecordingSeconds(0);
    setErrorByScope((current) => ({ ...current, [scopeKey]: null }));

    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const transcript = result[0]?.transcript.trim() ?? '';
        if (!transcript) continue;
        if (result.isFinal) {
          finalChunk = `${finalChunk} ${transcript}`.trim();
        } else {
          interimChunk = `${interimChunk} ${transcript}`.trim();
        }
      }

      if (finalChunk) {
        voiceTranscriptRef.current =
          `${voiceTranscriptRef.current} ${finalChunk}`.trim();
      }
      setDraft(
        `${voiceTranscriptRef.current} ${interimChunk}`.trimStart(),
      );
    };

    recognition.onerror = (event) => {
      sendVoiceOnEndRef.current = false;
      stopVoiceTimer();
      setVoiceState('idle');
      setRecordingSeconds(0);
      if (event.error === 'aborted') return;
      setErrorByScope((current) => ({
        ...current,
        [scopeKey]:
          event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'Нет доступа к микрофону. Разрешите его для FixNote в настройках Windows.'
            : 'Не удалось распознать речь. Попробуйте записать сообщение ещё раз.',
      }));
    };

    recognition.onend = () => {
      stopVoiceTimer();
      recognitionRef.current = null;
      const shouldSend = sendVoiceOnEndRef.current;
      const transcript = voiceTranscriptRef.current.trim();
      sendVoiceOnEndRef.current = false;
      setVoiceState('idle');
      setRecordingSeconds(0);

      if (shouldSend && transcript) {
        void send(transcript, { intent: 'capture' });
      } else if (shouldSend) {
        setDraft('');
        setErrorByScope((current) => ({
          ...current,
          [scopeKey]:
            'Речь не распознана. Попробуйте говорить ближе к микрофону.',
        }));
      }
    };

    try {
      recognition.start();
      setVoiceState('recording');
      const startedAt = Date.now();
      voiceTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
      }, 250);
    } catch {
      recognitionRef.current = null;
      setVoiceState('idle');
      setErrorByScope((current) => ({
        ...current,
        [scopeKey]: 'Не удалось запустить микрофон. Попробуйте ещё раз.',
      }));
    }
  }

  function startMediaRecording(stream: MediaStream) {
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    discardRecordingRef.current = false;
    voiceChunksRef.current = [];
    mediaRecorderRef.current = recorder;
    mediaStreamRef.current = stream;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) voiceChunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      discardRecordingRef.current = true;
      setErrorByScope((current) => ({
        ...current,
        [scopeKey]: 'Не удалось записать аудио. Попробуйте ещё раз.',
      }));
    };
    recorder.onstop = () => {
      const discarded = discardRecordingRef.current;
      const chunks = voiceChunksRef.current;
      const duration = Math.max(1, recordingDurationRef.current);
      const recordedType = recorder.mimeType || mimeType || 'audio/webm';
      voiceChunksRef.current = [];
      mediaRecorderRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      if (mediaStreamRef.current === stream) mediaStreamRef.current = null;
      stopVoiceTimer();
      setRecordingSeconds(0);

      if (discarded) {
        setVoiceState('idle');
        return;
      }
      const audio = new Blob(chunks, { type: recordedType });
      if (!audio.size) {
        setVoiceState('idle');
        setErrorByScope((current) => ({
          ...current,
          [scopeKey]: 'Запись получилась пустой. Попробуйте ещё раз.',
        }));
        return;
      }

      setVoiceState('processing');
      void transcribeAudio(audio)
        .then(async (transcript) => {
          setDraft(transcript);
          await send(transcript, {
            intent: 'capture',
            voiceAudio: audio,
            voiceDuration: duration,
          });
        })
        .catch(() => {
          setErrorByScope((current) => ({
            ...current,
            [scopeKey]:
              'Не удалось расшифровать запись. Проверьте Whisper-сервис и попробуйте ещё раз.',
          }));
        })
        .finally(() => setVoiceState('idle'));
    };

    try {
      recorder.start(500);
      setVoiceState('recording');
      setRecordingSeconds(0);
      recordingDurationRef.current = 0;
      setErrorByScope((current) => ({ ...current, [scopeKey]: null }));
      const startedAt = Date.now();
      voiceTimerRef.current = window.setInterval(() => {
        const seconds = Math.max(
          1,
          Math.floor((Date.now() - startedAt) / 1000),
        );
        recordingDurationRef.current = seconds;
        setRecordingSeconds(seconds);
      }, 250);
    } catch {
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      setVoiceState('idle');
      setErrorByScope((current) => ({
        ...current,
        [scopeKey]: 'Не удалось запустить запись. Попробуйте ещё раз.',
      }));
    }
  }

  function finishVoiceRecording() {
    if (voiceState !== 'recording') return;
    if (mediaRecorderRef.current?.state === 'recording') {
      setVoiceState('processing');
      mediaRecorderRef.current.stop();
      return;
    }
    if (!recognitionRef.current) return;
    sendVoiceOnEndRef.current = true;
    setVoiceState('processing');
    recognitionRef.current.stop();
  }

  function stopVoiceTimer() {
    if (voiceTimerRef.current === null) return;
    window.clearInterval(voiceTimerRef.current);
    voiceTimerRef.current = null;
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
          {
            context: buildResourceContext(resource),
            contextCitations: citationsForResources([resource]),
          },
        );
      }
      return;
    }

    const candidates = candidatesFromTransfer(event.dataTransfer);
    await importCandidatesIntoChat(candidates);
  }

  async function importCandidatesIntoChat(candidates: ImportCandidate[]) {
    if (!candidates.length || importing || sending) return;
    setImporting(true);
    setErrorByScope((current) => ({ ...current, [scopeKey]: null }));
    try {
      const created = await onImportAndAnalyze(candidates);
      if (!created.length) return;
      const confirmation: AiChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text:
          created.length === 1
            ? `✅ Заметка «${created[0]!.title}» сохранена.`
            : `✅ Сохранено заметок: ${created.length}.`,
        citations: created.map((resource) => ({
          resourceId: resource.id,
          nodeId: null,
          kind: resource.kind,
          title: resource.title,
          snippet: resource.preview,
          score: 1,
        })),
        proposal: null,
        createdAt: new Date().toISOString(),
      };
      setMessages(scopeKey, (current) => [...current, confirmation]);
      await send(
        created.length === 1
          ? 'Проанализируй сохранённый материал: дай краткое саммари, ключевые идеи и следующие шаги.'
          : `Проанализируй ${created.length} сохранённых материала: дай общее саммари, ключевые идеи, связи и следующие шаги.`,
        {
          context: buildImportAnalysisContext(created),
          contextCitations: citationsForResources(created),
        },
      );
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
    let appliedLocally = false;
    try {
      const resource = await onApplyProposal(proposal);
      appliedLocally = true;
      const capture = voiceCaptureByProposalRef.current.get(proposal.id);
      if (resource && capture) {
        await onAttachVoice(
          resource.id,
          capture.audio,
          capture.transcript,
          capture.duration,
        );
      }
      const result = await decideAiProposal(proposal.id, 'applied');
      replaceProposal(currentScopeKey, result.proposal);
      voiceCaptureByProposalRef.current.delete(proposal.id);
    } catch {
      setErrorByScope((current) => ({
        ...current,
        [currentScopeKey]:
          appliedLocally
            ? 'Заметка создана, но статус чата не обновился. Повторите действие.'
            : 'Не удалось применить действие. Попробуйте ещё раз.',
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
      voiceCaptureByProposalRef.current.delete(proposal.id);
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
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      modal={false}
      dismissable={false}
      ariaLabel="FixNote AI"
      className="ai-dock"
    >
        <div
          className="ai-dock-inner"
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
            <AnimatedBadge
              status={loading ? 'loading' : 'success'}
              size="sm"
              contentKey={loading ? 'loading' : scopeKey}
            >
              {loading ? 'Syncing' : scope ? 'Document' : 'Workspace'}
            </AnimatedBadge>
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
                  <AiProposalCard
                    proposal={message.proposal}
                    busy={busyProposalId === message.proposal.id}
                    onApply={() => void apply(message.proposal!)}
                    onReject={() => void reject(message.proposal!)}
                    onOpen={() => {
                      if (message.proposal?.resourceId) {
                        onOpenResource(message.proposal.resourceId);
                      }
                    }}
                  />
                )}
                <time className="ai-message-time" dateTime={message.createdAt}>
                  {formatMessageTime(message.createdAt)}
                </time>
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
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>

          <div className={`ai-dock-composer is-${voiceState}`}>
            <input
              ref={fileInputRef}
              className="ai-file-input"
              type="file"
              multiple
              tabIndex={-1}
              onChange={(event) => {
                const candidates = Array.from(event.target.files ?? []).map(
                  (file): ImportCandidate => ({ kind: 'file', file }),
                );
                event.target.value = '';
                void importCandidatesIntoChat(candidates);
              }}
            />
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (!files.length) return;
                event.preventDefault();
                void importCandidatesIntoChat(
                  files.map((file) => ({ kind: 'file', file })),
                );
              }}
              onKeyDown={(event) => {
                if (
                  voiceState === 'idle' &&
                  event.key === 'Enter' &&
                  !event.shiftKey
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={
                voiceState === 'recording'
                  ? 'Говорите…'
                  : voiceState === 'processing'
                    ? 'Распознаю запись…'
                    : 'Спросите что-нибудь…'
              }
              readOnly={voiceState !== 'idle'}
              disabled={loading || sending}
            />
            {voiceState === 'idle' && (
              <button
                className="attach-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || sending || importing}
                aria-label="Добавить файлы"
                title="Добавить файлы"
              >
                <Paperclip size={15} />
              </button>
            )}
            {voiceState !== 'idle' && (
              <div
                className={`voice-recording-state is-${voiceState}`}
                aria-live="polite"
              >
                <span className="voice-recording-dot" />
                <span>
                  {voiceState === 'recording'
                    ? `Запись ${formatRecordingTime(recordingSeconds)}`
                    : 'Готовлю сообщение…'}
                </span>
                {voiceState === 'recording' && (
                  <span className="voice-level" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            )}
            {draft && voiceState === 'idle' && (
              <button
                className="clear-draft"
                onClick={() => setDraft('')}
                aria-label="Clear"
              >
                <X size={14} />
              </button>
            )}
            <button
              className={`send-button${voiceState === 'recording' ? ' is-recording' : ''}${!draft.trim() && voiceState === 'idle' ? ' is-voice' : ''}`}
              onClick={() => {
                if (voiceState === 'recording') {
                  finishVoiceRecording();
                } else if (draft.trim()) {
                  void send();
                } else {
                  void startVoiceRecording();
                }
              }}
              disabled={loading || sending || voiceState === 'processing'}
              aria-label={
                voiceState === 'recording'
                  ? 'Завершить запись и отправить'
                  : draft.trim()
                    ? 'Отправить сообщение'
                    : 'Записать голосовое сообщение'
              }
            >
              {sending || voiceState === 'processing' ? (
                <LoaderCircle className="spin" size={17} />
              ) : voiceState === 'recording' ? (
                <Square size={13} fill="currentColor" />
              ) : draft.trim() ? (
                <ArrowUp size={17} />
              ) : (
                <Mic size={17} />
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
        </div>
    </Drawer>
  );
}

function getSpeechRecognitionConstructor():
  | BrowserSpeechRecognitionConstructor
  | null {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

function formatRecordingTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
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

function buildImportAnalysisContext(resources: WorkspaceResource[]): string {
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
  return materials.slice(0, 60_000);
}

function buildResourceContext(resource: WorkspaceResource): string {
  return buildImportAnalysisContext([resource]);
}

function citationsForResources(
  resources: WorkspaceResource[],
): AiChatMessage['citations'] {
  return resources.map((resource) => ({
    resourceId: resource.id,
    nodeId: null,
    kind: resource.kind,
    title: resource.title,
    snippet: resource.preview,
    score: 1,
  }));
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function AiProposalCard({
  proposal,
  busy,
  onApply,
  onReject,
  onOpen,
}: {
  proposal: AiProposal;
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
  onOpen: () => void;
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
      ) : proposal.status === 'applied' && proposal.resourceId ? (
        <button className="proposal-open" onClick={onOpen}>
          <FileText size={13} />
          Открыть
        </button>
      ) : (
        <span className={`proposal-status ${proposal.status}`}>
          {proposal.status === 'rejected' ? 'Отклонено' : 'Истекло'}
        </span>
      )}
    </div>
  );
}
