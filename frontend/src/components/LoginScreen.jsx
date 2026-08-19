import React, { useState } from 'react';
import { ClaudeMark } from '../icons';

export default function LoginScreen({ userHint = '', onLogin }) {
  const [user, setUser] = useState(userHint || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!user || !password || busy) return;
    setBusy(true);
    setError('');
    try { await onLogin(user, password); }
    catch (requestError) { setError(requestError?.message || 'Unable to sign in.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f6f2] px-4 text-[#2e2b27]">
      <form onSubmit={submit} className="w-full max-w-[390px] rounded-[24px] border border-[#e2dfd8] bg-white p-6 shadow-[0_20px_60px_rgba(50,45,38,.08)] sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#efe5df] text-[#b65f45]"><ClaudeMark className="h-6 w-6" /></div>
          <div><div className="text-[20px] font-semibold tracking-[-0.02em]">Claude Harness</div><div className="mt-0.5 text-[14px] text-[#8c8881]">Sign in to continue</div></div>
        </div>
        <label className="mb-1.5 block text-[13px] font-semibold">Username</label>
        <input autoFocus value={user} onChange={(event) => setUser(event.target.value)} autoComplete="username" placeholder="Enter username" className="mb-4 w-full rounded-xl border border-[#ddd9d2] bg-[#fbfaf8] px-3.5 py-3 text-[15px] outline-none transition focus:border-[#c9785c] focus:ring-2 focus:ring-[#c9785c]/10" />
        <label className="mb-1.5 block text-[13px] font-semibold">Password</label>
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="Enter password" className="w-full rounded-xl border border-[#ddd9d2] bg-[#fbfaf8] px-3.5 py-3 text-[15px] outline-none transition focus:border-[#c9785c] focus:ring-2 focus:ring-[#c9785c]/10" />
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}
        <button disabled={busy || !user || !password} className="mt-5 w-full rounded-xl bg-[#b96349] px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-[#a95840] disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
