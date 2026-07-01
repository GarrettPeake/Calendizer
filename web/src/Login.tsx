import { useState } from 'react';
import { validateCredentials, type ValidationIssue } from 'calendizer';
import { api, ApiError, setToken, type User } from './api';
import { issuesFor } from './components/formkit';

type Mode = 'login' | 'register';

export function Login(props: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null); // form-level (server)
  const [serverField, setServerField] = useState<{ field: string; message: string } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const v = validateCredentials(mode, { username, password, invite, confirm: mode === 'register' ? confirm : undefined });

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setServerField(null);
    setInvite('');
    setConfirm('');
    setAttempted(false);
    // keep username/password so the user doesn't retype when bouncing tabs
  }

  function msgs(field: string): ValidationIssue[] {
    const out: ValidationIssue[] = attempted ? issuesFor([...v.errors, ...v.warnings], field) : issuesFor(v.warnings, field);
    if (serverField && serverField.field === field) out.push({ field, message: serverField.message, severity: 'error' });
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setError(null);
    setServerField(null);
    if (!v.ok) return; // client validation blocks the round-trip
    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password, invite.trim());
      setToken(res.token);
      props.onAuthed(res.user);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  function handleError(err: unknown) {
    const status = err instanceof ApiError ? err.status : 0;
    const raw = err instanceof Error ? err.message : String(err);
    if (status === 409) setServerField({ field: 'username', message: 'That username is already taken.' });
    else if (status === 403) {
      if (/disabled/i.test(raw)) setError('Registration is currently closed.');
      else setServerField({ field: 'invite', message: "That invite code isn't valid." });
    } else if (status === 401) setError('Incorrect username or password.');
    else setError(raw || 'Something went wrong — please try again.');
  }

  const canSubmit = !busy && v.ok;

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit} aria-busy={busy}>
        <h1>Calendizer</h1>
        <p className="tagline">Create a dynamic calendar that just works</p>

        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} disabled={busy} onClick={() => switchMode('login')}>
            Log in
          </button>
          <button type="button" className={mode === 'register' ? 'on' : ''} disabled={busy} onClick={() => switchMode('register')}>
            Register
          </button>
        </div>

        <label className="field">
          <span>Username</span>
          <input
            type="text"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        <Msgs items={msgs('username')} />

        <label className="field">
          <span>Password</span>
          <div className="pw-wrap">
            <input
              type={showPw ? 'text' : 'password'}
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              disabled={busy}
            />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} aria-pressed={showPw} tabIndex={-1}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <Msgs items={msgs('password')} />

        {mode === 'register' ? (
          <>
            <label className="field">
              <span>Confirm password</span>
              <input
                type={showPw ? 'text' : 'password'}
                name="confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            <Msgs items={msgs('confirm')} />

            <label className="field">
              <span>Invite code</span>
              <input
                type="text"
                name="invite"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <Msgs items={msgs('invite')} />
          </>
        ) : null}

        {error ? <p className="auth-error">{error}</p> : null}

        <button className="btn" type="submit" disabled={!canSubmit} style={{ width: '100%', marginTop: 8 }}>
          {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

function Msgs({ items }: { items: ValidationIssue[] }) {
  if (!items.length) return null;
  return (
    <div className="field-msgs">
      {items.map((i, n) => (
        <p key={n} className={`field-msg ${i.severity}`}>
          {i.message}
        </p>
      ))}
    </div>
  );
}
