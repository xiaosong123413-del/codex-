/**
 * Wikipedia-style homepage and article reader for the local LLM Wiki.
 */

import { loadWikiModel, type WikiArticle, type WikiCategory, type WikiLink } from "../src/lib/wiki-data";

interface PageProps {
  searchParams?: Promise<{ path?: string; search?: string }>;
}

// fallow-ignore-next-line complexity
export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const model = loadWikiModel({ currentPath: params?.path });
  const query = params?.search?.trim() ?? "";
  const article = model.current;
  return (
    <div className="mw-page">
      <aside className="mw-sidebar">
        <Brand />
        <SidebarSection title="Navigation" links={["Main page", "Random article", "Search"]} />
        <SidebarSection title="Articles" links={model.recentlyUpdated.slice(0, 7).map((item) => item.title)} />
        <SidebarSection title="Categories" links={model.categories.slice(0, 12).map((item) => item.name)} />
      </aside>
      <main className="mw-main">
        <Header query={query} />
        <Tabs />
        {query ? <SearchResults query={query} articles={model.articles} /> : article ? <ArticleView article={article} model={model} /> : <MissingIndex />}
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="mw-brand">
      <div className="mw-mark">W</div>
      <strong>LLM Wiki</strong>
      <span>The Personal Encyclopedia</span>
    </div>
  );
}

function Header({ query }: { query: string }) {
  return (
    <header className="mw-header">
      <div className="mw-wordmark">LLM Wiki</div>
      <form className="mw-search">
        <input name="search" placeholder="Search LLM Wiki" defaultValue={query} />
        <button type="submit">Search</button>
      </form>
    </header>
  );
}

function SearchResults({ query, articles }: { query: string; articles: WikiArticle[] }) {
  const matches = articles.filter((article) => {
    const haystack = `${article.title}\n${article.summary}\n${article.raw}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  return (
    <section className="mw-search-results">
      <h1>Search results</h1>
      <p>
        Results for <strong>{query}</strong>
      </p>
      <ul>
        {matches.length === 0 ? (
          <li>No pages matched this search.</li>
        ) : (
          matches.slice(0, 50).map((article) => (
            <li key={article.path}>
              <ArticleLink article={article} />
              <p>{article.summary}</p>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function Tabs() {
  return (
    <nav className="mw-tabs" aria-label="Page tools">
      <a className="active">Article</a>
      <a>Talk</a>
      <span />
      <a className="active">Read</a>
      <a>Edit</a>
      <a>View history</a>
    </nav>
  );
}

function ArticleView({ article, model }: { article: WikiArticle; model: ReturnType<typeof loadWikiModel> }) {
  const isHome = article.path.toLowerCase() === "index.md";
  return isHome ? <IndexPage article={article} model={model} /> : <StandardArticle article={article} model={model} />;
}

function IndexPage({ article, model }: { article: WikiArticle; model: ReturnType<typeof loadWikiModel> }) {
  return (
    <div className="mw-home">
      <section className="mw-welcome">
        <h1>Welcome to LLM Wiki</h1>
        <p>the personal knowledge base compiled from your notes and sources.</p>
        <p>
          <strong>{model.articleCount}</strong> articles across <strong>{model.categories.length}</strong> categories
        </p>
      </section>
      <div className="mw-home-grid">
        <div>
          <Featured article={model.featured ?? article} />
          <CategoryBrowser categories={model.categories} />
        </div>
        <div>
          <RecentlyUpdated articles={model.recentlyUpdated} />
          <AboutBox />
        </div>
      </div>
    </div>
  );
}

function Featured({ article }: { article: WikiArticle }) {
  return (
    <section className="mw-box mw-box-blue">
      <h2>Featured article</h2>
      <div className="mw-feature">
        {article.images[0] ? <img src={article.images[0]} alt="" /> : <div className="mw-thumb">W</div>}
        <p>
          <ArticleLink article={article} /> -- {article.summary || "This article is ready for review in the wiki."}
        </p>
      </div>
      <a className="mw-read-more" href={`/?path=${encodeURIComponent(article.path)}`}>
        Read more {"->"}
      </a>
    </section>
  );
}

function CategoryBrowser({ categories }: { categories: WikiCategory[] }) {
  return (
    <section className="mw-box mw-box-green">
      <h2>Browse by category</h2>
      {categories.slice(0, 6).map((category) => (
        <div key={category.name} className="mw-category">
          <h3>{category.name}</h3>
          <ul>
            {category.articles.slice(0, 5).map((article) => (
              <li key={article.path}>
                <a href={`/?path=${encodeURIComponent(article.path)}`}>{article.title}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function RecentlyUpdated({ articles }: { articles: WikiArticle[] }) {
  return (
    <section className="mw-box mw-box-blue">
      <h2>Recently updated</h2>
      <ul>
        {articles.map((article) => (
          <li key={article.path}>
            <ArticleLink article={article} /> <small>({article.modifiedAt.slice(0, 10)})</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AboutBox() {
  return (
    <section className="mw-box">
      <h2>About</h2>
      <p>
        LLM Wiki is a personal knowledge encyclopedia compiled from local sources. Articles represent knowledge and
        patterns, not chat transcripts.
      </p>
    </section>
  );
}

function StandardArticle({ article, model }: { article: WikiArticle; model: ReturnType<typeof loadWikiModel> }) {
  const backlinks = model.backlinks[article.path] ?? [];
  return (
    <div className="mw-article-layout">
      <article className="mw-article">
        <h1>{article.title}</h1>
        <p className="mw-from">From LLM Wiki, the personal encyclopedia</p>
        <div dangerouslySetInnerHTML={{ __html: article.html }} />
      </article>
      <aside className="mw-infobar">
        <InfoList title="Contents" links={headings(article.raw)} />
        <InfoLinks title="Backlinks" links={backlinks} />
        <InfoText title="Sources" items={article.sources} />
        <InfoText title="Images" items={article.images} />
        <InfoLinks title="Related pages" links={article.links.map((link) => ({ path: `${link}.md`, title: link }))} />
      </aside>
    </div>
  );
}

function InfoList({ title, links }: { title: string; links: string[] }) {
  return <InfoText title={title} items={links} />;
}

function InfoLinks({ title, links }: { title: string; links: WikiLink[] }) {
  return (
    <section className="mw-info-section">
      <h3>{title}</h3>
      <ul>
        {links.length === 0 ? <li>None yet</li> : links.map((link) => <li key={link.path}><a href={`/?path=${encodeURIComponent(link.path)}`}>{link.title}</a></li>)}
      </ul>
    </section>
  );
}

function InfoText({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="mw-info-section">
      <h3>{title}</h3>
      <ul>{items.length === 0 ? <li>None yet</li> : items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}

function SidebarSection({ title, links }: { title: string; links: string[] }) {
  return (
    <section className="mw-sidebar-section">
      <h2>{title}</h2>
      {links.map((link) => <a key={link}>{link}</a>)}
    </section>
  );
}

function ArticleLink({ article }: { article: WikiArticle }) {
  return <a href={`/?path=${encodeURIComponent(article.path)}`}>{article.title}</a>;
}

function MissingIndex() {
  return <div className="mw-missing">This page does not exist. Compile the wiki first to generate wiki/index.md.</div>;
}

function headings(raw: string): string[] {
  return [...raw.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1]!).slice(0, 12);
}
