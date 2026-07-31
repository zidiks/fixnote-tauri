import type { AiChatMessage, AiProposal } from '@fixnote/contracts';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  Bot,
  ChevronRight,
  FileText,
  LoaderCircle,
  Mic,
  Paperclip,
  Pause,
  Play,
  Sparkles,
  Square,
  Upload,
  X,
} from 'lucide-react';
import {
  useEffect,
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
import { AiProposalCard } from './AIChat';

type VoiceState = 'idle' | 'recording' | 'processing';

interface SpeechAlternative { transcript: string }
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechResult };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface FlowChatProps {
  resources: WorkspaceResource[];
  voiceRequestToken: number;
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

interface SendOptions {
  context?: string;
  contextCitations?: AiChatMessage['citations'];
  intent?: 'chat' | 'capture';
  voiceDuration?: number;
  voiceAudio?: Blob;
}

export function FlowChat({
  resources,
  voiceRequestToken,
  onOpenResource,
  onApplyProposal,
  onAttachVoice,
  onImportAndAnalyze,
}: FlowChatProps) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceMessageIds, setVoiceMessageIds] = useState<Set<string>>(new Set());
  const [voiceDurations, setVoiceDurations] = useState<Record<string, number>>({});
  const [voiceAudioUrls, setVoiceAudioUrls] = useState<Record<string, string>>({});
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const transcriptRef = useRef('');
  const sendOnEndRef = useRef(false);
  const durationRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioUrlsRef = useRef<Set<string>>(new Set());
  const voiceCaptureByProposalRef = useRef<Map<string, {
    audio: Blob;
    transcript: string;
    duration: number;
  }>>(new Map());

  useEffect(() => {
    let active = true;
    void loadAiThread()
      .then((history) => {
        if (!active) return;
        setThreadId(history.threadId);
        setMessages(history.messages);
      })
      .catch(() => active && setError('Не удалось загрузить историю. Попробуйте ещё раз.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    discardRecordingRef.current = true;
    recognitionRef.current?.abort();
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    audioUrlsRef.current.clear();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (!voiceRequestToken) return;
    void startVoiceRecording();
    // A sidebar action intentionally starts the current composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceRequestToken]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: sending || importing ? 'smooth' : 'auto',
      block: 'end',
    });
  }, [importing, loading, messages.length, sending]);

  function stopTimer() {
    if (timerRef.current === null) return;
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function send(text = draft, options: SendOptions = {}) {
    const value = text.trim();
    if (!value || loading || sending) return;
    const optimisticId = crypto.randomUUID();
    const optimistic: AiChatMessage = {
      id: optimisticId,
      role: 'user',
      text: value,
      citations: [],
      proposal: null,
      createdAt: new Date().toISOString(),
    };
    setDraft('');
    setError(null);
    setSending(true);
    const audioUrl = options.voiceAudio
      ? URL.createObjectURL(options.voiceAudio)
      : null;
    if (audioUrl) {
      audioUrlsRef.current.add(audioUrl);
      setVoiceAudioUrls((current) => ({
        ...current,
        [optimisticId]: audioUrl,
      }));
    }
    if (options.voiceDuration) {
      setVoiceMessageIds((current) => new Set(current).add(optimisticId));
      setVoiceDurations((current) => ({
        ...current,
        [optimisticId]: options.voiceDuration!,
      }));
    }
    setMessages((current) => [...current, optimistic]);

    try {
      const response = await askAi(
        value,
        undefined,
        threadId ?? undefined,
        options.context,
        options.intent,
        options.contextCitations,
      );
      setThreadId(response.threadId);
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
      if (options.voiceDuration) {
        setVoiceMessageIds((current) => {
          const next = new Set(current);
          next.delete(optimisticId);
          next.add(response.userMessage.id);
          return next;
        });
        setVoiceDurations((current) => {
          const next = { ...current };
          delete next[optimisticId];
          next[response.userMessage.id] = options.voiceDuration!;
          return next;
        });
      }
      if (audioUrl) {
        setVoiceAudioUrls((current) => {
          const next = { ...current };
          delete next[optimisticId];
          next[response.userMessage.id] = audioUrl;
          return next;
        });
      }
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticId),
        response.userMessage,
        response.assistantMessage,
      ]);
    } catch {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setVoiceMessageIds((current) => {
        const next = new Set(current);
        next.delete(optimisticId);
        return next;
      });
      setVoiceDurations((current) => {
        const next = { ...current };
        delete next[optimisticId];
        return next;
      });
      setDraft(value);
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrlsRef.current.delete(audioUrl);
        setVoiceAudioUrls((current) => {
          const next = { ...current };
          delete next[optimisticId];
          return next;
        });
      }
      setError('Сообщение не отправилось. Текст сохранён — попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  }

  async function applyProposal(proposal: AiProposal) {
    if (proposal.status !== 'pending' || busyProposalId) return;
    setBusyProposalId(proposal.id);
    setError(null);
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
      replaceProposal(result.proposal);
      voiceCaptureByProposalRef.current.delete(proposal.id);
    } catch {
      setError(
        appliedLocally
          ? 'Заметка создана, но статус чата не обновился. Повторите действие.'
          : 'Не удалось применить действие. Попробуйте ещё раз.',
      );
    } finally {
      setBusyProposalId(null);
    }
  }

  async function rejectProposal(proposal: AiProposal) {
    if (proposal.status !== 'pending' || busyProposalId) return;
    setBusyProposalId(proposal.id);
    try {
      const result = await decideAiProposal(proposal.id, 'rejected');
      replaceProposal(result.proposal);
      voiceCaptureByProposalRef.current.delete(proposal.id);
    } catch {
      setError('Не удалось отклонить действие. Попробуйте ещё раз.');
    } finally {
      setBusyProposalId(null);
    }
  }

  function replaceProposal(proposal: AiProposal) {
    setMessages((current) => current.map((message) =>
      message.proposal?.id === proposal.id
        ? { ...message, proposal }
        : message,
    ));
  }

  async function importCandidatesIntoChat(candidates: ImportCandidate[]) {
    if (!candidates.length || importing || sending) return;
    setImporting(true);
    setError(null);
    try {
      const created = await onImportAndAnalyze(candidates);
      if (!created.length) return;
      setMessages((current) => [...current, importConfirmation(created)]);
      await send(
        created.length === 1
          ? 'Проанализируй сохранённый материал: дай краткое саммари, ключевые идеи и следующие шаги.'
          : `Проанализируй ${created.length} сохранённых материала: дай общее саммари, ключевые идеи, связи и следующие шаги.`,
        {
          context: buildAnalysisContext(created),
          contextCitations: citationsForResources(created),
        },
      );
    } catch {
      setError('Не удалось сохранить материал. Исходные данные не изменены.');
    } finally {
      setImporting(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDropActive(false);
    const resourceId = event.dataTransfer.getData('application/x-fixnote-resource-id');
    if (resourceId) {
      const resource = resources.find((candidate) => candidate.id === resourceId);
      if (resource) {
        await send(
          `Проанализируй «${resource.title}». Дай краткое резюме, ключевые идеи и следующие шаги.`,
          {
            context: buildAnalysisContext([resource]),
            contextCitations: citationsForResources([resource]),
          },
        );
      }
      return;
    }
    await importCandidatesIntoChat(candidatesFromTransfer(event.dataTransfer));
  }

  async function startVoiceRecording() {
    if (loading || sending || voiceState !== 'idle' || draft.trim()) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Нет доступа к микрофону. Разрешите его для FixNote в настройках Windows.');
      return;
    }
    if (typeof MediaRecorder !== 'undefined') {
      startMediaRecording(stream);
      return;
    }
    stream.getTracks().forEach((track) => track.stop());
    startBrowserRecognition();
  }

  function startMediaRecording(stream: MediaStream) {
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    discardRecordingRef.current = false;
    chunksRef.current = [];
    durationRef.current = 0;
    mediaRecorderRef.current = recorder;
    mediaStreamRef.current = stream;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const discarded = discardRecordingRef.current;
      const audio = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || 'audio/webm',
      });
      const duration = Math.max(1, durationRef.current);
      chunksRef.current = [];
      mediaRecorderRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      if (mediaStreamRef.current === stream) mediaStreamRef.current = null;
      stopTimer();
      setRecordingSeconds(0);
      if (discarded) {
        setVoiceState('idle');
        return;
      }
      if (!audio.size) {
        setVoiceState('idle');
        setError('Запись получилась пустой. Попробуйте ещё раз.');
        return;
      }
      setVoiceState('processing');
      void transcribeAudio(audio)
        .then(async (transcript) => {
          setDraft(transcript);
          await send(transcript, {
            intent: 'capture',
            voiceDuration: duration,
            voiceAudio: audio,
          });
        })
        .catch(() => setError(
          'Не удалось расшифровать запись. Проверьте Whisper-сервис и попробуйте ещё раз.',
        ))
        .finally(() => setVoiceState('idle'));
    };
    try {
      recorder.start(500);
      beginVoiceTimer();
    } catch {
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      setError('Не удалось запустить запись. Попробуйте ещё раз.');
    }
  }

  function startBrowserRecognition() {
    const Constructor = getSpeechRecognitionConstructor();
    if (!Constructor) {
      setError('Голосовой ввод недоступен в этой версии системы.');
      return;
    }
    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'ru-RU';
    recognitionRef.current = recognition;
    transcriptRef.current = '';
    sendOnEndRef.current = false;
    durationRef.current = 0;
    setDraft('');
    setError(null);
    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const text = result[0]?.transcript.trim() ?? '';
        if (!text) continue;
        if (result.isFinal) finalChunk = `${finalChunk} ${text}`.trim();
        else interimChunk = `${interimChunk} ${text}`.trim();
      }
      if (finalChunk) transcriptRef.current = `${transcriptRef.current} ${finalChunk}`.trim();
      setDraft(`${transcriptRef.current} ${interimChunk}`.trimStart());
    };
    recognition.onerror = (event) => {
      stopTimer();
      recognitionRef.current = null;
      sendOnEndRef.current = false;
      setVoiceState('idle');
      if (event.error !== 'aborted') setError('Не удалось распознать речь. Попробуйте ещё раз.');
    };
    recognition.onend = () => {
      stopTimer();
      recognitionRef.current = null;
      const shouldSend = sendOnEndRef.current;
      const transcript = transcriptRef.current.trim();
      const duration = Math.max(1, durationRef.current);
      sendOnEndRef.current = false;
      setVoiceState('idle');
      setRecordingSeconds(0);
      if (shouldSend && transcript) {
        void send(transcript, { intent: 'capture', voiceDuration: duration });
      } else if (shouldSend) {
        setError('Речь не распознана. Попробуйте говорить ближе к микрофону.');
      }
    };
    try {
      recognition.start();
      beginVoiceTimer();
    } catch {
      recognitionRef.current = null;
      setVoiceState('idle');
      setError('Не удалось запустить микрофон. Попробуйте ещё раз.');
    }
  }

  function beginVoiceTimer() {
    setVoiceState('recording');
    setRecordingSeconds(0);
    setError(null);
    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      durationRef.current = seconds;
      setRecordingSeconds(seconds);
    }, 250);
  }

  function finishVoiceRecording() {
    if (voiceState !== 'recording') return;
    if (mediaRecorderRef.current?.state === 'recording') {
      setVoiceState('processing');
      mediaRecorderRef.current.stop();
      return;
    }
    if (!recognitionRef.current) return;
    sendOnEndRef.current = true;
    setVoiceState('processing');
    recognitionRef.current.stop();
  }

  return (
    <section
      className="flow-chat"
      aria-label="Flow AI chat"
      onDragEnter={(event) => {
        if (!hasDropPayload(event.dataTransfer)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDropActive(true);
      }}
      onDragOver={(event) => {
        if (!hasDropPayload(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!hasDropPayload(event.dataTransfer)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setDropActive(false);
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <div className="flow-chat-scroll">
        <div className="flow-chat-intro">
          <span className="flow-chat-mark"><Sparkles size={18} /></span>
          <h1>Что сохраним?</h1>
          <p>Пишите, перетаскивайте файлы и ссылки или записывайте голосовые — FixNote создаст заметку и поможет её разобрать.</p>
        </div>

        <div className="flow-messages">
          {loading && <div className="flow-thread-loading"><LoaderCircle size={16} /> Загружаю историю…</div>}
          {!loading && messages.map((message) => (
            <motion.div
              key={message.id}
              className={`flow-message ${message.role}${voiceMessageIds.has(message.id) ? ' is-voice' : ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              {message.role === 'assistant' && <span className="flow-assistant-mark"><Bot size={14} /></span>}
              {voiceMessageIds.has(message.id) ? (
                <VoiceMessage
                  duration={voiceDurations[message.id] ?? Math.max(1, Math.ceil(message.text.length / 15))}
                  audioUrl={voiceAudioUrls[message.id]}
                />
              ) : <p>{message.text}</p>}
              {message.citations.map((citation) => (
                <button key={`${message.id}:${citation.resourceId}`} className="flow-citation" onClick={() => onOpenResource(citation.resourceId)}>
                  <FileText size={14} />
                  <span>{resources.find((resource) => resource.id === citation.resourceId)?.title ?? citation.title}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
              {message.proposal && (
                <AiProposalCard
                  proposal={message.proposal}
                  busy={busyProposalId === message.proposal.id}
                  onApply={() => void applyProposal(message.proposal!)}
                  onReject={() => void rejectProposal(message.proposal!)}
                  onOpen={() => {
                    if (message.proposal?.resourceId) onOpenResource(message.proposal.resourceId);
                  }}
                />
              )}
              <time className="flow-message-time" dateTime={message.createdAt}>
                {formatMessageTime(message.createdAt)}
              </time>
            </motion.div>
          ))}
          {sending && <div className="flow-message assistant flow-thinking"><span /><span /><span /></div>}
          {error && <div className="flow-chat-error">{error}</div>}
          <div ref={messagesEndRef} aria-hidden="true" />
        </div>
      </div>

      <div className={`flow-composer is-${voiceState}`}>
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
            void importCandidatesIntoChat(files.map((file) => ({ kind: 'file', file })));
          }}
          onKeyDown={(event) => {
            if (voiceState === 'idle' && event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={voiceState === 'recording' ? 'Говорите…' : voiceState === 'processing' ? 'Распознаю запись…' : 'Напишите сообщение или перетащите файл…'}
          readOnly={voiceState !== 'idle'}
          disabled={loading || sending}
          rows={1}
        />
        {voiceState === 'idle' && (
          <button
            className="flow-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || sending || importing}
            aria-label="Добавить файлы"
            title="Добавить файлы"
          >
            <Paperclip size={16} />
          </button>
        )}
        {voiceState === 'recording' && <div className="flow-recording"><i /> Запись {formatTime(recordingSeconds)} <span aria-hidden="true">▂▅▇▅▃</span></div>}
        {draft && voiceState === 'idle' && <button className="flow-clear" onClick={() => setDraft('')} aria-label="Очистить"><X size={15} /></button>}
        <button
          className={`flow-send${voiceState === 'recording' ? ' is-recording' : ''}${!draft.trim() && voiceState === 'idle' ? ' is-voice' : ''}`}
          onClick={() => voiceState === 'recording' ? finishVoiceRecording() : draft.trim() ? void send() : void startVoiceRecording()}
          disabled={loading || sending || voiceState === 'processing'}
          aria-label="Отправить или записать голосовое сообщение"
        >
          {sending || voiceState === 'processing' ? <LoaderCircle className="spin" size={17} /> : voiceState === 'recording' ? <Square size={13} fill="currentColor" /> : draft.trim() ? <ArrowUp size={17} /> : <Mic size={17} />}
        </button>
      </div>

      {dropActive && (
        <div className="ai-drop-overlay">
          <span><Upload size={23} /></span>
          <strong>Отпустите, чтобы сохранить</strong>
          <small>Каждый файл или ссылка станет заметкой и попадёт в AI-анализ.</small>
        </div>
      )}
      {importing && (
        <div className="ai-importing" role="status">
          <LoaderCircle className="spin" size={15} />
          Создаю заметки и готовлю анализ…
        </div>
      )}
    </section>
  );
}

function VoiceMessage({
  duration,
  audioUrl,
}: {
  duration: number;
  audioUrl: string | undefined;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const bars = [13, 19, 29, 38, 25, 17, 33, 23, 15, 31, 37, 21, 16, 26, 34, 18, 13];
  return (
    <div className="voice-message">
      <Mic size={15} />
      <span className="voice-message-time">{formatTime(duration)}</span>
      <span className="voice-wave" aria-hidden="true">
        {bars.map((height, index) => <i key={index} style={{ height }} />)}
      </span>
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setPlaying(false)}
        />
      )}
      <button
        aria-label={playing ? 'Пауза' : 'Воспроизвести голосовое'}
        disabled={!audioUrl}
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) {
            void audio.play().then(() => setPlaying(true));
          } else {
            audio.pause();
            setPlaying(false);
          }
        }}
      >
        {playing
          ? <Pause size={15} fill="currentColor" />
          : <Play size={15} fill="currentColor" />}
      </button>
    </div>
  );
}

function importConfirmation(resources: WorkspaceResource[]): AiChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    text: resources.length === 1
      ? `✅ Заметка «${resources[0]!.title}» сохранена.`
      : `✅ Сохранено заметок: ${resources.length}.`,
    citations: citationsForResources(resources),
    proposal: null,
    createdAt: new Date().toISOString(),
  };
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

function buildAnalysisContext(resources: WorkspaceResource[]): string {
  return resources.map((resource, index) => {
    const imported = resource.imported;
    const source = imported?.kind === 'link'
      ? imported.url
      : imported?.kind === 'text'
        ? imported.text
        : imported?.kind === 'file' && imported.text
          ? imported.text
          : resource.preview;
    return `${index + 1}. ${resource.title}\n${source.slice(0, 12_000)}`;
  }).join('\n\n').slice(0, 60_000);
}

function hasDropPayload(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes('application/x-fixnote-resource-id') ||
    dataTransfer.files.length > 0 ||
    dataTransfer.types.includes('Files') ||
    dataTransfer.types.includes('text/plain') ||
    dataTransfer.types.includes('text/uri-list');
}

function candidatesFromTransfer(dataTransfer: DataTransfer): ImportCandidate[] {
  const files = Array.from(dataTransfer.files);
  if (files.length) return files.map((file) => ({ kind: 'file', file }));
  const uriList = dataTransfer.getData('text/uri-list')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .join('\n');
  return candidatesFromText(uriList || dataTransfer.getData('text/plain'));
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const target = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return target.SpeechRecognition ?? target.webkitSpeechRecognition ?? null;
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
