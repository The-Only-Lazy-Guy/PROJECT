import type { ChatMessage, GraphSummary, RunRequest, RunResponse, RunStreamEvent } from '../types';
import { LiveRunCockpit } from './LiveRunCockpit';

type Settings = { k_anchors: number; anchor_strategy: RunRequest['anchor_strategy'] };

export function ChatPage(props: {
  messages: ChatMessage[];
  question: string;
  setQuestion: (q: string) => void;
  onSubmit: () => void;
  onExample: (text: string) => void;
  loading: boolean;
  lastRun: RunResponse | null;
  liveTokens: string;
  liveEvents: RunStreamEvent[];
  liveQuestion: string;
  selectedGraph?: GraphSummary;
  clearChat: () => void;
  onBackToOverview?: () => void;
  graphs?: GraphSummary[];
  onGraphChange?: (id: string) => void;
  settings?: Settings;
  onSettingsChange?: (s: Settings) => void;
}) {
  return <LiveRunCockpit {...props} />;
}
