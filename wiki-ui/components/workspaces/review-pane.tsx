'use client';

import { useEffect, useState } from 'react';

type ReviewItem = {
  id: string;
  kind: string;
  sourcePath: string;
  target?: string;
  status?: string;
  notes?: string;
};

export function ReviewPane() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadItems() {
      const response = await fetch('/api/review', { cache: 'no-store' });
      const payload = await response.json();
      if (!ignore) {
        setItems(payload.items ?? []);
        setLoading(false);
      }
    }

    loadItems();
    return () => {
      ignore = true;
    };
  }, []);

  async function resolveItem(id: string) {
    await fetch('/api/review', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status: 'resolved' }),
    });
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <section className="workspace-section">
      <p className="workspace-kicker">Review</p>
      <h1 className="workspace-title">Review Queue</h1>
      <p className="workspace-muted">
        {loading ? 'Loading review queue...' : `${items.length} open review items`}
      </p>
      <div className="workspace-thread-list">
        {items.map((item) => (
          <div className="workspace-card" key={item.id}>
            <h3>{item.kind}</h3>
            <p>{item.sourcePath}</p>
            {item.target ? <p className="workspace-muted">Target: {item.target}</p> : null}
            {item.notes ? <p className="workspace-muted">{item.notes}</p> : null}
            <button className="workspace-button-secondary" onClick={() => resolveItem(item.id)}>
              Mark resolved
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
