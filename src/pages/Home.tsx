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
      <button onClick={() => navigate('/samly')} className="flex items-center" aria-label="Samly home"><img src="https://ndktajhxihahgfdcsuij.supabase.co/storage/v1/object/public/homepage-media/samlylogo.webp" alt="Samly" className="h-9 w-auto" /></button>
      <div className="flex items-center gap-3">
        <button onClick={() => setLanguage(de ? 'en' : 'de')} className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-white">{de ? 'EN' : 'DE'}</button>
        <button onClick={() => navigate('/samly/login')} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">{de ? 'Anmelden' : 'Sign in'}</button>
      </div>
    </header>
    <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:pt-24">
      <div>
        <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-800"><ShieldCheck className="h-4 w-4" />{de ? 'Buchhaltung, die bei dir bleibt' : 'Accounting that stays yours'}</p>
        <h1 className="max-w-3xl text-5xl font-bold tracking-[-.04em] sm:text-6xl lg:text-7xl">{de ? 'Klar sehen, was dein Unternehmen bewegt.' : 'See your business clearly.'}</h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">{de ? 'Samly bringt Belege, Rechnungen, Bankbewegungen und Auswertungen in einen ruhigen, sicheren Arbeitsbereich.' : 'Samly brings receipts, invoices, bank movements and reports into one calm, secure workspace.'}</p>
        <div className="mt-8 flex flex-wrap gap-3"><button onClick={() => navigate('/samly/signup')} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700">{de ? 'Loslegen' : 'Get started'} <ArrowRight className="h-4 w-4" /></button><a href="#pricing" className="rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold hover:border-slate-500">{de ? 'Preise ansehen' : 'View pricing'}</a></div>
      </div>
      <div className="rounded-[2rem] bg-slate-950 p-6 text-white shadow-2xl sm:p-8">
        <div className="flex items-center justify-between text-sm text-slate-400"><span>{de ? 'Dein Überblick' : 'Your overview'}</span><span className="rounded-full bg-white/10 px-3 py-1">2026</span></div>
        <div className="mt-8 rounded-2xl bg-white p-5 text-slate-900"><p className="text-sm font-medium text-slate-500">{de ? 'Heute zu prüfen' : 'Ready for review'}</p><p className="mt-2 text-4xl font-bold">12</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-2/3 rounded-full bg-blue-600" /></div></div>
        <div className="mt-4 grid grid-cols-2 gap-4"><div className="rounded-2xl bg-white/10 p-5"><ReceiptText className="h-5 w-5 text-blue-300"/><p className="mt-4 text-sm text-slate-300">{de ? 'Belege' : 'Receipts'}</p><p className="mt-1 text-2xl font-bold">24</p></div><div className="rounded-2xl bg-white/10 p-5"><FileCheck2 className="h-5 w-5 text-emerald-300"/><p className="mt-4 text-sm text-slate-300">{de ? 'Offene Rechnungen' : 'Open invoices'}</p><p className="mt-1 text-2xl font-bold">6</p></div></div>
      </div>
    </section>
    <section className="border-y border-slate-200 bg-white"><div className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><p className="text-sm font-semibold uppercase tracking-[.18em] text-blue-700">{de ? 'So arbeitet Samly' : 'How Samly works'}</p><h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">{de ? 'Weniger Verwaltungsaufwand. Mehr Sicherheit bei jeder Zahl.' : 'Less admin. More confidence in every number.'}</h2><div className="mt-10 grid gap-5 md:grid-cols-3">{features.map(([title, text], index) => <article key={title} className="rounded-2xl border border-slate-200 p-6"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-700">0{index + 1}</div><h3 className="mt-5 text-lg font-bold">{title}</h3><p className="mt-2 leading-7 text-slate-600">{text}</p></article>)}</div></div></section>
    <section id="pricing" className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="rounded-[2rem] bg-blue-600 px-7 py-10 text-white sm:px-12"><Globe2 className="h-7 w-7"/><h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{de ? 'Eine klare Lösung für dein Unternehmen.' : 'One clear plan for your business.'}</h2><div className="mt-7 flex flex-wrap gap-3 text-blue-950"><div className="rounded-2xl bg-white px-5 py-4"><span className="text-3xl font-bold">€10</span><span className="ml-2 text-sm font-medium">{de ? '/ Monat' : '/ month'}</span></div><div className="rounded-2xl bg-blue-500 px-5 py-4 text-white"><span className="text-3xl font-bold">€100</span><span className="ml-2 text-sm font-medium">{de ? '/ Jahr' : '/ year'}</span></div></div><p className="mt-6 max-w-2xl text-blue-100">{de ? 'Ein Arbeitsbereich für die Buchhaltung deines Unternehmens. Sichere Zahlungsabwicklung folgt in Kürze.' : 'One workspace for your company’s accounting. Secure checkout is coming soon.'}</p></div></section>
    <footer className="border-t border-slate-200 px-5 py-8 text-center text-sm text-slate-500">© {new Date().getFullYear()} Samly</footer>
  </main>;
}
