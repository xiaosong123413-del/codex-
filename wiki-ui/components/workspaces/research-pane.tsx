'use client';

import { useEffect, useState } from 'react';

type ResearchJob = {
  id: string;
  topic: string;
  status: string;
  resultJson?: string | null;
};

export function ResearchPane() {
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [topic, setTopic] = useState('');

  async function loadJobs() {
    const response = await fetch('/api/research', { cache: 'no-store' });
    const payload = await response.json();
    setJobs(payload.jobs ?? []);
  }

  useEffect(() => {
    loadJobs();
  }, []);

  async function createJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!topic.trim()) return;

    await fetch('/api/research', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic }),
    });
    setTopic('');
    await loadJobs();
  }

  return (
    <section className="workspace-section">
      <p className="workspace-kicker">Deep Research</p>
      <h1 className="workspace-title">Research Jobs</h1>
      <form className="workspace-form" onSubmit={createJob}>
        <input
          className="workspace-input"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Create a research brief for a topic"
        />
        <button className="workspace-button" type="submit">
          Start brief
        </button>
      </form>
      <div className="workspace-thread-list" style={{ marginTop: 20 }}>
        {jobs.map((job) => {
          const result = job.resultJson ? JSON.parse(job.resultJson) : null;
          return (
            <div className="workspace-card" key={job.id}>
              <h3>{job.topic}</h3>
              <p className="workspace-muted">Status: {job.status}</p>
              {result?.questions?.length ? (
                <>
                  <h4>Research questions</h4>
                  <ul className="workspace-list">
                    {result.questions.map((question: string) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
