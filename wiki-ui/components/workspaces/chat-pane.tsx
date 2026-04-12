'use client';

export function ChatPane() {
  return (
    <section>
      <h1>Chat</h1>
      <textarea
        defaultValue=""
        placeholder="Ask the knowledge base..."
        style={{ width: '100%', minHeight: 180, padding: 12, border: '1px solid #a2a9b1' }}
      />
    </section>
  );
}
