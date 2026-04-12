'use client';

import { useEffect, useState } from 'react';

type ChatThread = {
  id: string;
  title: string;
};

type ChatMessage = {
  id: string;
  role: string;
  content: string;
};

type ChatPaneProps = {
  activePagePath?: string | null;
};

export function ChatPane({ activePagePath }: ChatPaneProps) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');

  async function loadMessages(nextThreadId: string) {
    const response = await fetch(`/api/chat?threadId=${encodeURIComponent(nextThreadId)}`, {
      cache: 'no-store',
    });
    const payload = await response.json();
    setMessages(payload.messages ?? []);
  }

  async function loadThreads(nextThreadId?: string | null) {
    const response = await fetch('/api/chat', { cache: 'no-store' });
    const payload = await response.json();
    const nextThreads = payload.threads ?? [];
    const selectedThreadId = nextThreadId ?? threadId ?? nextThreads[0]?.id ?? null;
    setThreads(nextThreads);
    setThreadId(selectedThreadId);
    if (selectedThreadId) {
      await loadMessages(selectedThreadId);
    } else {
      setMessages([]);
    }
  }

  useEffect(() => {
    loadThreads();
  }, []);

  async function sendPrompt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, threadId, activePagePath }),
    });
    const payload = await response.json();
    setPrompt('');
    await loadThreads(payload.threadId ?? threadId);
  }

  return (
    <section className="workspace-grid-two">
      <div className="workspace-card">
        <p className="workspace-kicker">Threads</p>
        <h1 className="workspace-title">Chat</h1>
        <div className="workspace-thread-list">
          {threads.map((thread) => (
            <button
              className={`workspace-thread-button ${thread.id === threadId ? 'workspace-thread-button-active' : ''}`}
              key={thread.id}
              onClick={() => {
                setThreadId(thread.id);
                loadMessages(thread.id);
              }}
              type="button"
            >
              {thread.title}
            </button>
          ))}
        </div>
      </div>
      <div className="workspace-card">
        <p className="workspace-kicker">Conversation</p>
        <div className="workspace-chat-log">
          {messages.map((message) => (
            <div
              className={`workspace-chat-message ${message.role === 'assistant' ? 'workspace-chat-message-assistant' : ''}`}
              key={message.id}
            >
              <strong>{message.role === 'assistant' ? 'Assistant' : 'You'}</strong>
              <div className="workspace-article-text">{message.content}</div>
            </div>
          ))}
        </div>
        <form className="workspace-form" onSubmit={sendPrompt} style={{ marginTop: 16 }}>
          <textarea
            className="workspace-textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask the knowledge base..."
          />
          <button className="workspace-button" type="submit">
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
