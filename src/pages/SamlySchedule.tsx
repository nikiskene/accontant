import { useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const calendarUrl = 'https://nikiskenecal.netlify.app/book/samly';

export function SamlySchedule() {
  const { language, setLanguage } = useLanguage();
  const de = language === 'de';
  useEffect(() => {
    const previous = document.title;
    document.title = de ? 'Gespräch buchen · Samly' : 'Book a call · Samly';
    return () => { document.title = previous; };
  }, [de]);
  return <div className="min-h-screen bg-[#fbfaf8] text-slate-900">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
      <a href="/samly" aria-label="Samly home"><img src="https://ndktajhxihahgfdcsuij.supabase.co/storage/v1/object/public/homepage-media/samlylogo.webp" alt="Samly" className="h-14 w-auto" /></a>
      <button onClick={() => setLanguage(de ? 'en' : 'de')} className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-white">{de ? 'EN' : 'DE'}</button>
    </header>
    <main className="mx-auto max-w-6xl px-3 pb-10 sm:px-8">
      <div className="px-2 pb-6 pt-3 sm:pt-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{de ? 'Lass uns über Samly sprechen.' : 'Let’s talk about Samly.'}</h1>
        <p className="mt-3 text-slate-600">{de ? 'Buche ein Gespräch mit Niki. Wähle einfach einen passenden Termin.' : 'Book a call with Niki. Choose a time that works for you.'}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <iframe src={calendarUrl} title={de ? 'Termin mit Niki buchen' : 'Book a Samly call with Niki'} className="block h-[1050px] w-full border-0 sm:h-[900px]" referrerPolicy="strict-origin-when-cross-origin" />
      </div>
      <p className="mt-4 px-2 text-sm text-slate-600"><a href={calendarUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline underline-offset-4">{de ? 'Kalender in einem neuen Tab öffnen' : 'Open calendar in a new tab'}</a></p>
      <nav aria-label={de ? 'Rechtliche Informationen' : 'Legal information'} className="mt-6 flex flex-wrap gap-5 px-2 text-sm text-slate-600">
        <a href="/samly/legal?document=notice" className="hover:underline">{de ? 'Impressum' : 'Legal notice'}</a>
        <a href="/samly/privacy" className="hover:underline">{de ? 'Datenschutz' : 'Privacy'}</a>
        <a href="mailto:admin@iacy.com" className="hover:underline">admin@iacy.com</a>
      </nav>
    </main>
  </div>;
}
