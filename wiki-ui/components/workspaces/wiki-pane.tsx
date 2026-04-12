type WikiPaneProps = {
  pageMeta: { pages?: Array<{ title: string; path: string }> };
  activePage: { title?: string; path?: string } | null;
};

export function WikiPane({ pageMeta, activePage }: WikiPaneProps) {
  return (
    <section>
      <h1>Wiki</h1>
      <p>Selected: {activePage?.title ?? 'None'}</p>
      <ul>
        {(pageMeta.pages ?? []).slice(0, 12).map((page) => (
          <li key={page.path}>{page.title}</li>
        ))}
      </ul>
    </section>
  );
}
