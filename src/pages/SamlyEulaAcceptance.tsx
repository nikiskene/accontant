import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../components/Button';
import { supabase } from '../lib/supabase';
import { provisionPendingSamlySignup } from './SamlySignup';
import { useLanguage } from '../contexts/LanguageContext';

function navigate(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }

export function SamlyEulaAcceptance() {
  const { language, setLanguage } = useLanguage();
  const de = language === 'de';
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { void (async () => { const { data: { user } } = await supabase.auth.getUser(); if (!user) { navigate('/samly/login'); return; } setReady(true); })(); }, []);
  const agree = async () => {
    setBusy(true); setMessage('');
    try {
      const provisioned = await provisionPendingSamlySignup();
      if (!provisioned) throw new Error(de ? 'Deine Einrichtung konnte nicht gefunden werden. Bitte starte die Registrierung erneut.' : 'We could not find your setup. Please start registration again.');
      navigate('/samly/app');
    } catch (error: any) { setMessage(error.message || (de ? 'Die Zustimmung konnte nicht gespeichert werden.' : 'Your agreement could not be recorded.')); }
    setBusy(false);
  };

  if (!ready) return null;
  return <main className="min-h-screen bg-[#fbfaf8] px-5 py-8 text-slate-900 sm:px-8"><div className="mx-auto max-w-2xl"><header className="flex items-center justify-between"><button onClick={() => navigate('/samly')} className="text-xl font-bold tracking-tight">samly<span className="text-blue-600">.</span></button><button onClick={() => setLanguage(de ? 'en' : 'de')} className="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-white">{de ? 'EN' : 'DE'}</button></header><section className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10"><ShieldCheck className="h-8 w-8 text-blue-600"/><p className="mt-5 text-xs font-semibold uppercase tracking-[.18em] text-blue-700">{de ? 'LETZTER SCHRITT' : 'ONE LAST STEP'}</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{de ? 'Bevor Samly loslegt' : 'Before Samly gets to work'}</h1><p className="mt-4 leading-7 text-slate-700">{de ? 'Samly hilft beim Organisieren. Du bleibst für jede Buchung, Rechnung, Steuerentscheidung und Meldung verantwortlich.' : 'Samly helps organise the work. You remain responsible for every booking, invoice, tax decision and filing.'}</p><div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm leading-6 text-blue-950"><strong>{de ? 'Wichtig:' : 'Important:'}</strong> {de ? 'Vorschläge, Berechnungen, Extraktionen und Berichte können unvollständig, verspätet oder fehlerhaft sein. Prüfe jedes Ergebnis vor seiner Verwendung.' : 'Suggestions, calculations, extractions and reports can be incomplete, delayed or incorrect. Review every result before using it.'}</div><p className="mt-6 text-sm leading-6 text-slate-600">{de ? 'Mit „Zustimmen & fortfahren“ akzeptierst du die ' : 'By selecting “Agree & continue”, you accept the '}<button onClick={() => navigate('/samly/legal?document=terms')} className="font-semibold text-blue-700 underline">{de ? 'AGB' : 'Terms'}</button>{de ? ', die ' : ', '}<button onClick={() => navigate('/samly/legal?document=eula')} className="font-semibold text-blue-700 underline">EULA</button>{de ? ', die ' : ', '}<button onClick={() => navigate('/samly/legal?document=privacy')} className="font-semibold text-blue-700 underline">{de ? 'Datenschutzerklärung' : 'Privacy Policy'}</button>{de ? ' und den ' : ' and the '}<button onClick={() => navigate('/samly/legal?document=tax')} className="font-semibold text-blue-700 underline">{de ? 'Steuerhinweis' : 'tax notice'}</button>.</p>{message && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{message}</p>}<Button onClick={() => void agree()} disabled={busy} className="mt-7 w-full">{busy ? '…' : (de ? 'Zustimmen & fortfahren' : 'Agree & continue')}</Button></section></div></main>;
}
