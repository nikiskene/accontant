import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useLanguage } from '../contexts/LanguageContext';

function navigate(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }

export function SamlyLogin() {
  const { language, setLanguage, t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message); else navigate('/samly/app');
    setLoading(false);
  };
  return <div className="relative min-h-screen overflow-hidden bg-slate-950">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,#2563eb_0%,transparent_28%),radial-gradient(circle_at_85%_80%,#0f766e_0%,transparent_24%)]" />
    <div className="relative flex min-h-screen flex-col justify-between p-5 sm:p-10 lg:p-16">
      <div className="flex items-center justify-between"><button onClick={() => navigate('/samly')} className="text-3xl font-bold tracking-tight text-white">samly<span className="text-blue-400">.</span></button><button onClick={() => setLanguage(language === 'en' ? 'de' : 'en')} className="rounded-full border border-white/30 px-3 py-2 text-sm font-semibold text-white">{language === 'en' ? 'DE' : 'EN'}</button></div>
      <div className="w-full self-end rounded-2xl bg-white/95 p-6 shadow-2xl backdrop-blur sm:max-w-md sm:p-8"><div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-700">{t.secureAccess}</p><h1 className="mt-1 text-2xl font-bold text-gray-900">{t.signIn}</h1></div>
        <form onSubmit={handleSubmit} className="space-y-4"><Input type="email" label={t.email} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /><Input type="password" label={t.password} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t.enterPassword} required />{error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}<Button type="submit" disabled={loading} className="w-full">{loading ? t.signingIn : t.signIn}</Button></form>
      </div>
    </div>
  </div>;
}
