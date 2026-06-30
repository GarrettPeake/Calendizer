import { useState } from 'react';
import { api, setToken, type User } from './api';

export function Login(props: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password, invite.trim());
      setToken(res.token);
      props.onAuthed(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>Calendizer</h1>
        <p className="tagline">Create a dynamic calendar that just works</p>

        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
            Log in
          </button>
          <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
            Register
          </button>
        </div>

        <label className="field">
          <span>Username</span>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mode === 'register' ? (
          <label className="field">
            <span>Invite code</span>
            <input type="text" value={invite} onChange={(e) => setInvite(e.target.value)} />
          </label>
        ) : null}

        {error ? <p className="auth-error">{error}</p> : null}

        <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
