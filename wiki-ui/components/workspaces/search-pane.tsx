type SearchPaneProps = {
  searchIndex: { documents?: Array<{ path?: string; title?: string }> };
};

export function SearchPane({ searchIndex }: SearchPaneProps) {
  return (
    <section>
      <h1>Search</h1>
      <p>Indexed documents: {searchIndex.documents?.length ?? 0}</p>
    </section>
  );
}
