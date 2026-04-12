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
      <hr />
      <h3>Context</h3>
      <p>{activePage?.title ?? 'No page selected'}</p>
      <p>Incoming backlinks: {backlinks?.incoming?.length ?? 0}</p>
      <p>Outgoing links: {backlinks?.outgoing?.length ?? 0}</p>
      <p>Absorb status: {absorbRecord?.status ?? 'n/a'}</p>
    </div>
  );
}
