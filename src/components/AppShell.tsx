type AppShellProps = {
  page: 'reader' | 'options';
};

const readerCopy = {
  eyebrow: 'Independent reader',
  title: 'Thesis Viewer is ready for its reading workspace.',
  description:
    'This initial page only establishes the extension surface. PDF and web-paper import, rendering, annotations, and AI features are not available yet.',
};

const optionsCopy = {
  eyebrow: 'Settings',
  title: 'Settings will be added with the model integration.',
  description:
    'This initial page does not collect, save, or send an API address, model name, or key. Those controls belong to a later milestone.',
};

export function AppShell({ page }: AppShellProps) {
  const copy = page === 'reader' ? readerCopy : optionsCopy;

  return (
    <main className="page-shell" aria-labelledby="page-title">
      <section className="status-card">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 id="page-title">{copy.title}</h1>
        <p>{copy.description}</p>
        <p className="status" role="status">
          Status: extension skeleton — no document is loaded.
        </p>
      </section>
    </main>
  );
}
