import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

const STORAGE_PREFIX = 'samly-first-use-tour-v1:';

type TourStep = {
  title: string;
  text: string;
  path?: string;
  action?: string;
};

const steps: TourStep[] = [
  {
    title: 'Welcome to Samly',
    text: 'A calm place for invoices, receipts and the bits of bookkeeping that usually steal your afternoon.',
  },
  {
    title: 'Start with your company',
    text: 'Add the legal details, currency, tax year and bank details that make your documents yours.',
    path: '/company-profile',
    action: 'Show company settings',
  },
  {
    title: 'Sell without spreadsheet acrobatics',
    text: 'Create customers, products and invoices here. Samly keeps the paperwork connected as you go.',
    path: '/sales-documents',
    action: 'Show invoices',
  },
  {
    title: 'Give receipts a home',
    text: 'Forward or upload receipts to the Receipt Inbox, check the suggested details, then review before anything is booked.',
    path: '/receipt-inbox',
    action: 'Show receipt inbox',
  },
  {
    title: 'Keep an eye on the money',
    text: 'Import bank statements, match transactions and use Reports when you want the numbers without the drama.',
    path: '/bank-inbox',
    action: 'Show bank inbox',
  },
  {
    title: 'You are ready',
    text: 'The sidebar is your map. Your free setup allowance is shown at the bottom, and you can subscribe whenever Samly earns its keep.',
  },
];

type SamlyFirstUseTourProps = {
  userId: string;
  onNavigate: (path: string) => void;
};

export function SamlyFirstUseTour({ userId, onNavigate }: SamlyFirstUseTourProps) {
  const storageKey = `${STORAGE_PREFIX}${userId}`;
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setOpen(window.localStorage.getItem(storageKey) !== 'done');
  }, [storageKey]);

  const finish = () => {
    window.localStorage.setItem(storageKey, 'done');
    setOpen(false);
  };

  const startAgain = () => {
    window.localStorage.removeItem(storageKey);
    setStepIndex(0);
    setOpen(true);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={startAgain}
        className="hidden rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 sm:inline-flex"
      >
        Take a tour
      </button>
    );
  }

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const move = (next: number) => {
    const nextStep = steps[next];
    setStepIndex(next);
    if (nextStep.path) onNavigate(nextStep.path);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="samly-tour-title">
      <section className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
        <button type="button" onClick={finish} aria-label="End tour" title="End tour" className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
          <X className="h-5 w-5" />
        </button>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Samly quick tour · {stepIndex + 1}/{steps.length}</p>
        <h2 id="samly-tour-title" className="mt-3 pr-8 text-2xl font-bold tracking-tight text-slate-900">{step.title}</h2>
        <p className="mt-3 text-base leading-7 text-slate-600">{step.text}</p>
        {step.action && <button type="button" onClick={() => onNavigate(step.path!)} className="mt-5 text-sm font-semibold text-blue-700 hover:text-blue-800">{step.action} →</button>}
        <div className="mt-7 flex items-center justify-between gap-3">
          <button type="button" onClick={() => move(stepIndex - 1)} disabled={isFirst} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex gap-1.5" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
            {steps.map((_, index) => <span key={index} className={`h-1.5 rounded-full transition-all ${index === stepIndex ? 'w-5 bg-blue-600' : 'w-1.5 bg-slate-200'}`} />)}
          </div>
          <button type="button" onClick={() => isLast ? finish() : move(stepIndex + 1)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">
            {isLast ? 'Let’s go' : 'Next'} {!isLast && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </section>
    </div>
  );
}
