import { useState } from 'react';

/** Natural-language → intent. Delegates the request to the parent (which adds
 *  config/today context), then shows the model's one-line explanation. */
export function AIComposer(props: { onSubmit: (text: string) => Promise<{ explanation?: string }> }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function go() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const r = await props.onSubmit(text.trim());
      setNote(r.explanation || 'Added.');
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="section">
      <h2>✨ Describe an event</h2>
      <div className="card">
        <textarea
          rows={3}
          placeholder={'e.g. "Find me 3 evenings this week to practice guitar for 1–2 hours"'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') go();
          }}
          spellCheck={false}
        />
        <button className="btn" style={{ marginTop: 8, width: '100%' }} disabled={loading || !text.trim()} onClick={go}>
          {loading ? 'Asking Claude…' : 'Add with AI'}
        </button>
        {error ? <p className="empty-hint" style={{ color: '#ffb4b6' }}>{error}</p> : null}
        {note ? <p className="empty-hint" style={{ color: '#9fd8a0', fontStyle: 'normal' }}>✓ {note}</p> : null}
        <p className="empty-hint" style={{ marginTop: 6 }}>
          Claude turns your words into a structured intent — review/tweak it in the list below. ⌘/Ctrl+Enter to submit.
        </p>
      </div>
    </div>
  );
}
