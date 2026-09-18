import { LanguageProvider, useLanguage } from '../contexts/LanguageContext';
import { Home } from './Home';
import { SamlyLogin } from './SamlyLogin';
import { SamlySignup } from './SamlySignup';

function SamlyRoutes() {
  const { language } = useLanguage();
  const path = window.location.pathname;
  if (path === '/samly/signup') return <SamlySignup />;
  if (path === '/samly/login') return <SamlyLogin />;
  if (path === '/samly/app') return <main className="min-h-screen bg-[#fbfaf8] p-6 sm:p-12"><button onClick={() => { window.history.pushState({}, '', '/samly'); window.dispatchEvent(new PopStateEvent('popstate')); }} className="flex items-center" aria-label="Samly home"><img src="https://ndktajhxihahgfdcsuij.supabase.co/storage/v1/object/public/homepage-media/samlylogo.webp" alt="Samly" className="h-9 w-auto" /></button><section className="mx-auto mt-20 max-w-xl rounded-3xl border border-slate-200 bg-white p-8"><p className="text-sm font-semibold text-blue-700">{language === 'de' ? 'KONTO-EINRICHTUNG' : 'ACCOUNT SETUP'}</p><h1 className="mt-3 text-3xl font-bold">{language === 'de' ? 'Dein sicherer Arbeitsbereich wird vorbereitet.' : 'Your secure workspace is being prepared.'}</h1><p className="mt-4 leading-7 text-slate-600">{language === 'de' ? 'Die öffentliche Kontotrennung wird vor der Freischaltung eingerichtet.' : 'Public account isolation is being installed before this workspace is enabled.'}</p></section></main>;
  return <Home />;
}

export function SamlyApp() { return <LanguageProvider><SamlyRoutes /></LanguageProvider>; }
