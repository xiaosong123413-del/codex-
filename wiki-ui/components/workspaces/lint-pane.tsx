type LintPaneProps = {
  lint: { brokenLinks?: Array<unknown>; orphanPages?: Array<unknown> };
};

export function LintPane({ lint }: LintPaneProps) {
  return (
    <section>
      <h1>Lint</h1>
      <p>Broken links: {lint.brokenLinks?.length ?? 0}</p>
      <p>Orphan pages: {lint.orphanPages?.length ?? 0}</p>
    </section>
  );
}
