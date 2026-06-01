import { useEffect, useState } from 'react';
import { getGraphs, getHealth } from './api';
import type { GraphSummary, HealthResponse, RunRequest } from './types';
import { Sidebar } from './components/Sidebar';
import { LandingPage } from './components/LandingPage';
import { ChatPage } from './components/ChatPage';
import { useChat } from './hooks/useChat';
import { useTheme } from './components/ThemeToggle';
import 'katex/dist/katex.min.css';

function App() {
  const [page, setPage] = useState<'overview' | 'chat'>('chat');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [selectedGraph, setSelectedGraph] = useState('');
  const [question, setQuestion] = useState('');
  const [settings, setSettings] = useState({
    k_anchors: 8,
    anchor_strategy: 'topk' as RunRequest['anchor_strategy'],
  });

  const chat = useChat();
  const { theme, toggle: toggleTheme } = useTheme();

  async function refresh() {
    const [nextHealth, nextGraphs] = await Promise.all([
      getHealth().catch((exc: Error) => {
        chat.setError(exc.message);
        return null;
      }),
      getGraphs().catch((exc: Error) => {
        chat.setError(exc.message);
        return [];
      }),
    ]);
    setHealth(nextHealth);
    setGraphs(nextGraphs);
    if (!selectedGraph && nextGraphs.length > 0) {
      const preferred = nextGraphs.find(
        (g) => g.file === 'merged_graph.json' || g.id === 'merged_graph',
      );
      setSelectedGraph(preferred?.id ?? nextGraphs[0].id);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function handleSubmit() {
    void chat.submit(question, selectedGraph, settings);
    setQuestion('');
  }

  function handleExample(text: string) {
    void chat.submit(text, selectedGraph, settings);
  }

  if (page === 'overview') {
    return (
      <LandingPage
        health={health}
        onStart={() => setPage('chat')}
      />
    );
  }

  return (
    <div className="shell">
      <Sidebar
        page={page}
        onPageChange={setPage}
        graphs={graphs}
        selectedGraph={selectedGraph}
        onGraphChange={setSelectedGraph}
        settings={settings}
        onSettingsChange={setSettings}
        health={health}
        onRefresh={() => void refresh()}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="main main-chat">
        {chat.error && (
          <div className="error-banner">
            <strong>Run issue</strong>
            <span>{chat.error}</span>
          </div>
        )}
        <ChatPage
          messages={chat.messages}
          question={question}
          setQuestion={setQuestion}
          onSubmit={handleSubmit}
          onExample={handleExample}
          loading={chat.loading}
          lastRun={chat.lastRun}
          liveTokens={chat.liveTokens}
          liveEvents={chat.liveEvents}
          liveQuestion={chat.liveQuestion}
          selectedGraph={graphs.find((g) => g.id === selectedGraph)}
          clearChat={chat.clearChat}
          onBackToOverview={() => setPage('overview')}
          graphs={graphs}
          onGraphChange={setSelectedGraph}
          settings={settings}
          onSettingsChange={setSettings}
        />
      </main>
    </div>
  );
}

export default App;
