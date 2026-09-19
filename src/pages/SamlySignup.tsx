import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { useLanguage } from '../contexts/LanguageContext';

type Form = { companyName: string; country: 'AT' | 'AE'; email: string; password: string };
const storageKey = 'samly-pending-signup';
function navigate(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }

async function provision(companyName: string, country: 'AT' | 'AE', language: 'en' | 'de') {
  const { error } = await supabase.rpc('create_samly_account', { p_company_name: companyName.trim(), p_country: country, p_language_code: language });
  if (error) throw error;
  localStorage.removeItem(storageKey);
}

export function SamlySignup() {
  const { language, setLanguage } = useLanguage();
  const de = language === 'de';
  const [form, setForm] = useState<Form>({ companyName: '', country: 'AT', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [existingUser, setExistingUser] = useState(false);
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setExistingUser(!!data.user)); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!acceptedLegal) { setMessage(de ? 'Bitte bestätige den rechtlichen Hinweis.' : 'Please acknowledge the legal notice.'); return; }
    setLoading(true); setMessage('');
    const { data: current } = await supabase.auth.getUser();
    if (current.user) {
      try { await provision(form.companyName, form.country, language); navigate('/samly/app'); }
      catch (error: any) { setMessage(error.message || (de ? 'Konto konnte nicht erstellt werden.' : 'Your account could not be created.')); }
      setLoading(false); return;
    }
    const { data, error } = await supabase.auth.signUp({ email: form.email.trim(), password: form.password });
    if (error) { setLoading(false); setMessage(error.message); return; }
    localStorage.setItem(storageKey, JSON.stringify({ companyName: form.companyName.trim(), country: form.country, language, email: form.email.trim().toLowerCase() }));
    try {
      if (data.session) {
        await provision(form.companyName, form.country, language);
        navigate('/samly/app');
      } else {
        setMessage(de ? 'Bitte bestätige deine E-Mail und melde dich danach an. Dein Konto wird dann eingerichtet.' : 'Confirm your email, then sign in. We will set up your account at that point.');
      }
    } catch (error: any) { setMessage(error.message || (de ? 'Konto konnte nicht erstellt werden.' : 'Your account could not be created.')); }
    setLoading(false);
  };

  return <div className="relative min-h-screen overflow-hidden bg-slate-950"><div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,#2563eb_0%,transparent_28%),radial-gradient(circle_at_85%_80%,#0f766e_0%,transparent_24%)]" />
    <div className="relative mx-auto flex min-h-screen max-w-xl flex-col justify-center p-5 sm:p-10"><div className="mb-8 flex items-center justify-between"><button onClick={() => navigate('/samly')} className="flex items-center" aria-label="Samly home"><img src="https://ndktajhxihahgfdcsuij.supabase.co/storage/v1/object/public/homepage-media/samlylogo.webp" alt="Samly" className="h-11 w-auto" /></button><button onClick={() => setLanguage(de ? 'en' : 'de')} className="rounded-full border border-white/30 px-3 py-2 text-sm font-semibold text-white">{de ? 'EN' : 'DE'}</button></div>
      <section className="rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-700">{de ? 'SAMLY KONTO' : 'SAMLY ACCOUNT'}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{de ? 'Unternehmen einrichten' : 'Set up your company'}</h1><p className="mt-3 leading-6 text-slate-600">{de ? 'Dein Arbeitsbereich wird nur für dich erstellt. Du kannst ihn später in den Einstellungen vervollständigen.' : 'Your workspace is created only for you. You can complete company details later in Settings.'}</p>
        <form onSubmit={submit} className="mt-7 space-y-4"><Input label={de ? 'Unternehmensname' : 'Company name'} value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} required /><Select label={de ? 'Land' : 'Country'} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value as 'AT' | 'AE' })}><option value="AT">Österreich · EUR</option><option value="AE">United Arab Emirates · AED</option></Select>{existingUser?<p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{de ? 'Du bist bereits angemeldet. Wir erstellen nur den getrennten Samly-Arbeitsbereich.' : 'You are already signed in. We will create only your separate Samly workspace.'}</p>:<><Input type="email" label={de ? 'E-Mail' : 'Email'} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" required /><Input type="password" minLength={8} label={de ? 'Passwort' : 'Password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={de ? 'Mindestens 8 Zeichen' : 'At least 8 characters'} required /></>}<label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-5 text-slate-700"><input type="checkbox" checked={acceptedLegal} onChange={(event) => setAcceptedLegal(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600" /><span>{de ? 'Ich habe den ' : 'I have read the '}<button type="button" onClick={() => navigate('/samly/legal')} className="font-semibold text-blue-700 underline">{de ? 'rechtlichen Hinweis' : 'legal notice'}</button>{de ? ' gelesen und bestätige, dass Samly keine Steuer- oder Rechtsberatung erbringt.' : ' and understand that Samly does not provide tax or legal advice.'}</span></label>{message && <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</p>}<Button type="submit" disabled={loading} className="w-full">{loading ? (de ? 'Wird erstellt…' : 'Creating…') : (de ? 'Sicheren Arbeitsbereich erstellen' : 'Create secure workspace')}</Button></form>
        <p className="mt-5 text-center text-sm text-slate-600">{de ? 'Schon registriert?' : 'Already registered?'} <button type="button" onClick={() => navigate('/samly/login')} className="font-semibold text-blue-700 hover:underline">{de ? 'Anmelden' : 'Sign in'}</button></p>
      </section>
    </div>
  </div>;
}

export async function provisionPendingSamlySignup() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;
  const input = JSON.parse(raw) as { companyName: string; country: 'AT' | 'AE'; language: 'en' | 'de'; email?: string };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !input.email || user.email?.toLowerCase() !== input.email.toLowerCase()) return false;
  await provision(input.companyName, input.country, input.language);
  return true;
}
