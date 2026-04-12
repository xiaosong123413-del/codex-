import type { ReactNode } from 'react';

type RightContextPanelProps = {
  activePage: { title?: string; path?: string } | null;
  backlinks: { incoming?: string[]; outgoing?: string[] } | null;
  absorbRecord: { status?: string; compiledInto?: string[] } | null;
  children: ReactNode;
};

export function RightContextPanel({
  activePage,
  backlinks,
  absorbRecord,
  children,
}: RightContextPanelProps) {
  return (
    <div>
      {children}
      <div className="workspace-section" style={{ marginTop: 16 }}>
        <h3 className="workspace-title">Context</h3>
        <p>{activePage?.title ?? 'No page selected'}</p>
        <p className="workspace-muted">Incoming backlinks: {backlinks?.incoming?.length ?? 0}</p>
        <p className="workspace-muted">Outgoing links: {backlinks?.outgoing?.length ?? 0}</p>
        <p className="workspace-muted">Absorb status: {absorbRecord?.status ?? 'n/a'}</p>
        {backlinks?.incoming?.length ? (
          <>
            <h4>What links here</h4>
            <ul className="workspace-list">
              {backlinks.incoming.slice(0, 10).map((pagePath) => (
                <li key={pagePath}>{pagePath}</li>
              ))}
            </ul>
          </>
        ) : null}
        {backlinks?.outgoing?.length ? (
          <>
            <h4>Outgoing</h4>
            <ul className="workspace-list">
              {backlinks.outgoing.slice(0, 10).map((pagePath) => (
                <li key={pagePath}>{pagePath}</li>
              ))}
            </ul>
          </>
        ) : null}
        {absorbRecord?.compiledInto?.length ? (
          <>
            <h4>Compiled Into</h4>
            <ul className="workspace-list">
              {absorbRecord.compiledInto.map((pagePath) => (
                <li key={pagePath}>{pagePath}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
