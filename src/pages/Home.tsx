import { ArrowRight, FileCheck2, Globe2, ReceiptText, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

function navigate(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }

export function Home() {
  const { language, setLanguage } = useLanguage();
  const de = language === 'de';
  const features = de
    ? [['Belege, sofort bereit', 'E-Mails und Belege landen in einer klaren Prüfung, bevor sie gebucht werden.'], ['Rechnungen im Griff', 'Erstelle, versende und verfolge Angebote und Rechnungen aus einem Ort.'], ['Saubere Auswertungen', 'Deine Zahlen bleiben nach Unternehmen und Währung getrennt und nachvollziehbar.']]
    : [['Receipts, ready to review', 'Incoming email and documents arrive in a clear review flow before they are booked.'], ['Invoices under control', 'Create, send and follow up on quotes and invoices from one place.'], ['Reports you can trust', 'Keep figures separated by company and currency, with an audit trail behind every decision.']];
  return <main className="min-h-screen bg-[#fbfaf8] text-slate-900">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
      <button onClick={() => navigate('/samly')} className="flex items-center" aria-label="Samly home"><img src="https://ndktajhxihahgfdcsuij.supabase.co/storage/v1/object/public/homepage-media/samlylogo.webp" alt="Samly" className="h-[4.5rem] w-auto" /></button>
      <div className="flex items-center gap-3">
        <button onClick={() => setLanguage(de ? 'en' : 'de')} className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-white">{de ? 'EN' : 'DE'}</button>
        <button onClick={() => navigate('/samly/login')} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">{de ? 'Anmelden' : 'Sign in'}</button>
      </div>
    </header>
    <section className="relative isolate min-h-[680px] overflow-hidden border-y border-slate-700 bg-slate-900">
      <img src="https://ndktajhxihahgfdcsuij.supabase.co/storage/v1/object/public/homepage-media/Samly%20Hero.png" alt="Samly turns scattered accounting work into a calm, organised flow" className="absolute inset-0 -z-20 h-full w-full object-cover object-center" />
      <div className="absolute inset-0 -z-10 bg-[#40566a]/80 mix-blend-multiply" />
      <div className="absolute inset-0 -z-10 bg-slate-950/30" />
      <div className="mx-auto flex min-h-[680px] max-w-6xl items-center px-5 py-20 sm:px-8">
        <div className="max-w-xl text-white">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm"><ShieldCheck className="h-4 w-4" />{de ? 'Dein Konto. Dein Überblick.' : 'Your books. Your overview.'}</p>
          <h1 className="text-5xl font-bold tracking-[-.04em] drop-shadow-sm sm:text-6xl lg:text-7xl">{de ? 'Mehr Spaß. Weniger Beleg-Ballett.' : 'Have more fun. Let Samly do the paperwork.'}</h1>
          <p className="mt-6 max-w-lg text-lg font-medium leading-8 text-white/95">{de ? 'Belege sind klein. Steuerregeln eher nicht. Onkel Samly sortiert den Papierkram, damit du wieder die guten Dinge bauen kannst.' : 'Receipts are tiny. Tax rules are not. Let Uncle Samly sort the paperwork while you get back to the good stuff.'}</p>
          <div className="mt-8 flex flex-wrap gap-3"><button onClick={() => navigate('/samly/signup')} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-semibold text-slate-950 shadow-lg hover:bg-slate-100">{de ? 'Loslegen' : 'Get started'} <ArrowRight className="h-4 w-4" /></button><a href="#pricing" className="rounded-full border border-white/60 bg-white/10 px-6 py-3 font-semibold text-white backdrop-blur-sm hover:bg-white/20">{de ? 'Preise ansehen' : 'View plans'}</a></div>
        </div>
      </div>
    </section>
    <section className="border-y border-slate-200 bg-white"><div className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><p className="text-sm font-semibold uppercase tracking-[.18em] text-blue-700">{de ? 'So arbeitet Samly' : 'How Samly works'}</p><h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">{de ? 'Weniger Verwaltungsaufwand. Mehr Sicherheit bei jeder Zahl.' : 'Less admin. More confidence in every number.'}</h2><div className="mt-10 grid gap-5 md:grid-cols-3">{features.map(([title, text], index) => <article key={title} className="rounded-2xl border border-slate-200 p-6"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-700">0{index + 1}</div><h3 className="mt-5 text-lg font-bold">{title}</h3><p className="mt-2 leading-7 text-slate-600">{text}</p></article>)}</div></div></section>
    <section id="pricing" className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="rounded-[2rem] bg-blue-600 px-7 py-10 text-white sm:px-12"><Globe2 className="h-7 w-7"/><h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{de ? 'Eine klare Lösung für dein Unternehmen.' : 'One clear plan for your business.'}</h2><div className="mt-7 flex flex-wrap gap-3 text-blue-950"><div className="rounded-2xl bg-white px-5 py-4"><span className="text-3xl font-bold">€10</span><span className="ml-2 text-sm font-medium">{de ? '/ Monat' : '/ month'}</span></div><div className="rounded-2xl bg-blue-500 px-5 py-4 text-white"><span className="text-3xl font-bold">€100</span><span className="ml-2 text-sm font-medium">{de ? '/ Jahr' : '/ year'}</span></div></div><p className="mt-6 max-w-2xl text-blue-100">{de ? 'Ein Arbeitsbereich für die Buchhaltung deines Unternehmens. Sichere Zahlungsabwicklung folgt in Kürze.' : 'One workspace for your company’s accounting. Secure checkout is coming soon.'}</p></div></section>
    <footer className="border-t border-slate-200 px-5 py-8 text-center text-sm text-slate-500">© {new Date().getFullYear()} Samly · <button onClick={() => navigate('/samly/legal')} className="font-medium text-slate-700 hover:underline">{de ? 'Rechtlicher Hinweis' : 'Legal notice'}</button></footer>
  </main>;
}
