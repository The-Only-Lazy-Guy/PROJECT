import { useState, useEffect, useCallback } from 'react';
import { streamGraphAgent } from '../api';
import type { ChatMessage, GraphSummary, HealthResponse, RunRequest, RunResponse, RunStreamEvent, SubstrateData } from '../types';

const STORAGE_KEY = 'graph-agent.messages';

function loadStored(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as ChatMessage[] : [];
  } catch {
    return [];
  }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadStored);
  const [lastRun, setLastRun] = useState<RunResponse | null>(null);
  const [liveEvents, setLiveEvents] = useState<RunStreamEvent[]>([]);
  const [liveTokens, setLiveTokens] = useState('');
  const [liveQuestion, setLiveQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  const submit = useCallback(async (
    clean: string,
    selectedGraph: string,
    settings: { k_anchors: number; anchor_strategy: RunRequest['anchor_strategy'] },
  ) => {
    if (!clean || !selectedGraph || loading) return;
    setError(null);
    setLoading(true);
    setLiveEvents([]);
    setLiveTokens('');
    setLiveQuestion(clean);
    setLastRun(null);
    setMessages((prev) => [...prev, { role: 'user', content: clean }]);

    try {
      const run = await streamGraphAgent(
        {
          question: clean,
          graph_id: selectedGraph,
          k_anchors: settings.k_anchors,
          anchor_strategy: settings.anchor_strategy,
          use_failure_boost: true,
          enable_plan_tree: false,
          enable_procedures: false,
          enable_activation: true,
        },
        (event) => {
          setLiveEvents((prev) => [...prev.slice(-120), event]);
          if (event.event === 'token') {
            setLiveTokens((prev) => prev + String(event.data.text ?? ''));
          } else if (event.event === 'action_complete' && event.data.content) {
            setLiveTokens(String(event.data.content));
          }
        },
      );
      setLastRun(run);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: run.answer, runId: run.run_id },
      ]);
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc);
      setError(message);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Run failed: ${message}` }]);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setLastRun(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    messages, setMessages,
    lastRun, setLastRun,
    liveEvents, liveTokens,
    liveQuestion,
    loading, error, setError,
    submit, clearChat,
  };
}
