import type { AiChatMessage } from '@fixnote/contracts';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  Bot,
  ChevronRight,
  FileText,
  LoaderCircle,
  Mic,
  Play,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceResource } from '../domain';
import { askAi, loadAiThread } from '../lib/api';

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
}

export function FlowChat({
  resources,
  voiceRequestToken,
  onOpenResource,
}: FlowChatProps) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceMessageIds, setVoiceMessageIds] = useState<Set<string>>(new Set());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef('');
  const sendOnEndRef = useRef(false);
  const durationRef = useRef(0);
  const timerRef = useRef<number | null>(null);

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
    recognitionRef.current?.abort();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (!voiceRequestToken) return;
    void startVoiceRecording();
    // Only sidebar requests should start a recording; the function intentionally
    // reads the current composer state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceRequestToken]);

  function stopTimer() {
    if (timerRef.current === null) return;
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function send(text = draft, voiceDuration?: number) {
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
    if (voiceDuration) {
      setVoiceMessageIds((current) => new Set(current).add(optimisticId));
    }
    setMessages((current) => [...current, optimistic]);

    try {
      const response = await askAi(value, undefined, threadId ?? undefined);
      setThreadId(response.threadId);
      if (voiceDuration) {
        setVoiceMessageIds((current) => {
          const next = new Set(current);
          next.delete(optimisticId);
          next.add(response.userMessage.id);
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
      setDraft(value);
      setError('Сообщение не отправилось. Текст сохранён — попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  }

  async function startVoiceRecording() {
    if (loading || sending || voiceState !== 'idle' || draft.trim()) return;
    const Constructor = getSpeechRecognitionConstructor();
    if (!Constructor) {
      setError('Голосовой ввод недоступен в этой версии системы.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
      stream?.getTracks().forEach((track) => track.stop());
    } catch {
      setError('Нет доступа к микрофону. Разрешите его для FixNote в настройках Windows.');
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
        const text = result?.[0]?.transcript.trim() ?? '';
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
      if (shouldSend && transcript) void send(transcript, duration);
      else if (shouldSend) setError('Речь не распознана. Попробуйте говорить ближе к микрофону.');
    };
    try {
      recognition.start();
      setVoiceState('recording');
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        durationRef.current = seconds;
        setRecordingSeconds(seconds);
      }, 250);
    } catch {
      recognitionRef.current = null;
      setVoiceState('idle');
      setError('Не удалось запустить микрофон. Попробуйте ещё раз.');
    }
  }

  function finishVoiceRecording() {
    if (voiceState !== 'recording' || !recognitionRef.current) return;
    sendOnEndRef.current = true;
    setVoiceState('processing');
    recognitionRef.current.stop();
  }

  return (
    <section className="flow-chat" aria-label="Flow AI chat">
      <div className="flow-chat-scroll">
        <div className="flow-chat-intro">
          <span className="flow-chat-mark"><Sparkles size={18} /></span>
          <h1>Что сохраним?</h1>
          <p>Пишите, вставляйте ссылки и голосовые — FixNote сохранит контекст и поможет его разобрать.</p>
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
                <VoiceMessage duration={Math.max(1, Math.ceil(message.text.length / 15))} />
              ) : <p>{message.text}</p>}
              {message.citations.map((citation) => (
                <button key={`${message.id}:${citation.resourceId}`} className="flow-citation" onClick={() => onOpenResource(citation.resourceId)}>
                  <FileText size={14} />
                  <span>{resources.find((resource) => resource.id === citation.resourceId)?.title ?? citation.title}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </motion.div>
          ))}
          {sending && <div className="flow-message assistant flow-thinking"><span /><span /><span /></div>}
          {error && <div className="flow-chat-error">{error}</div>}
        </div>
      </div>

      <div className={`flow-composer is-${voiceState}`}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (voiceState === 'idle' && event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={voiceState === 'recording' ? 'Говорите…' : voiceState === 'processing' ? 'Распознаю запись…' : 'Напишите сообщение или вставьте ссылку…'}
          readOnly={voiceState !== 'idle'}
          disabled={loading || sending}
          rows={1}
        />
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
    </section>
  );
}

function VoiceMessage({ duration }: { duration: number }) {
  const bars = [13, 19, 29, 38, 25, 17, 33, 23, 15, 31, 37, 21, 16, 26, 34, 18, 13];
  return <div className="voice-message"><Mic size={15} /><span className="voice-message-time">{formatTime(duration)}</span><span className="voice-wave" aria-hidden="true">{bars.map((height, index) => <i key={index} style={{ height }} />)}</span><button aria-label="Воспроизвести голосовое"><Play size={15} fill="currentColor" /></button></div>;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const target = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return target.SpeechRecognition ?? target.webkitSpeechRecognition ?? null;
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
