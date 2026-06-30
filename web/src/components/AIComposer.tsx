import { useState } from 'react';
import { SectionHeader } from './SectionHeader';
import { WandIcon } from './icons';

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
      setNote(r.explanation || 'Added');
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="section">
      <SectionHeader
        icon={<WandIcon />}
        title="Describe your event or intention"
        hint="Describe an intent in plain language and AI will do all the form filling"
      />
      <div className="card">
        <textarea
          rows={3}
          placeholder={'e.g. "Coffee date tomorrow at 7", "Find me 3 evenings this week to practice guitar for 1–2 hours", or "I work out at 7pm on MWF"'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') go();
          }}
          spellCheck={false}
        />
        <button className="btn" style={{ marginTop: 8, width: '100%' }} disabled={loading || !text.trim()} onClick={go}>
          {loading ? 'Processing…' : 'Add with AI'}
        </button>
        {error ? <p className="empty-hint" style={{ color: 'var(--danger)' }}>{error}</p> : null}
        {note ? <p className="empty-hint" style={{ color: 'var(--ink)', fontStyle: 'normal' }}>{note}</p> : null}
      </div>
    </div>
  );
}
