type PreviewPaneProps = {
  activePage: { title?: string; path?: string; abstract?: string } | null;
};

export function PreviewPane({ activePage }: PreviewPaneProps) {
  if (!activePage) {
    return <div>No preview available.</div>;
  }

  return (
    <article>
      <h2>{activePage.title}</h2>
      <p>{activePage.path}</p>
      <p>{activePage.abstract ?? ''}</p>
    </article>
  );
}
