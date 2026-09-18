import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type Language = 'en' | 'de';

type Copy = {
  language: string; signIn: string; signOut: string; secureAccess: string; email: string; password: string; enterPassword: string; signingIn: string;
  nav: Record<string, string>; taxYear: string; noAccess: string; noAccessDetail: string;
};

const copy: Record<Language, Copy> = {
  en: {
    language: 'Deutsch',
    signIn: 'Sign in',
    signOut: 'Sign out',
    secureAccess: 'Secure access',
    email: 'Email',
    password: 'Password',
    enterPassword: 'Enter your password',
    signingIn: 'Signing in…',
    nav: {
      Company: 'Company', Sales: 'Sales', Costs: 'Costs', Accounting: 'Accounting', Private: 'Private',
      Companies: 'Companies', 'Company Credentials': 'Company details', 'Bank Details': 'Bank details', 'Tax Years': 'Tax years',
      Dashboard: 'Dashboard', 'Quotes & Invoices': 'Quotes & invoices', Receivables: 'Receivables', 'Products & Services': 'Products & services', Customers: 'Customers', 'Document Layouts': 'Document layouts', 'New Sale': 'New sale',
      'Receipt Inbox': 'Receipt inbox', 'New Expense': 'New expense', Trips: 'Trips', Suppliers: 'Suppliers', 'Supplier Invoices': 'Supplier invoices',
      'Bank Inbox': 'Bank inbox', 'Statement Imports': 'Statement imports', Transactions: 'Transactions', Reports: 'Reports', 'Fixed Assets & AfA': 'Fixed assets & depreciation', Settings: 'Settings', 'Audit Log': 'Audit log', 'Private Insolvency': 'Private insolvency',
    },
    taxYear: 'Tax year', noAccess: 'No access to account', noAccessDetail: 'You do not have permission to access this account.',
  },
  de: {
    language: 'English',
    signIn: 'Anmelden',
    signOut: 'Abmelden',
    secureAccess: 'Sicherer Zugang',
    email: 'E-Mail',
    password: 'Passwort',
    enterPassword: 'Passwort eingeben',
    signingIn: 'Anmeldung…',
    nav: {
      Company: 'Unternehmen', Sales: 'Umsatz', Costs: 'Kosten', Accounting: 'Buchhaltung', Private: 'Privat',
      Companies: 'Unternehmen', 'Company Credentials': 'Unternehmensdaten', 'Bank Details': 'Bankverbindungen', 'Tax Years': 'Steuerjahre',
      Dashboard: 'Übersicht', 'Quotes & Invoices': 'Angebote & Rechnungen', Receivables: 'Forderungen', 'Products & Services': 'Produkte & Leistungen', Customers: 'Kunden', 'Document Layouts': 'Dokumentlayouts', 'New Sale': 'Neuer Umsatz',
      'Receipt Inbox': 'Belegeingang', 'New Expense': 'Neue Ausgabe', Trips: 'Reisen', Suppliers: 'Lieferanten', 'Supplier Invoices': 'Eingangsrechnungen',
      'Bank Inbox': 'Bankeingang', 'Statement Imports': 'Kontoauszüge importieren', Transactions: 'Buchungen', Reports: 'Auswertungen', 'Fixed Assets & AfA': 'Anlagevermögen & AfA', Settings: 'Einstellungen', 'Audit Log': 'Prüfprotokoll', 'Private Insolvency': 'Private Insolvenz',
    },
    taxYear: 'Steuerjahr', noAccess: 'Kein Zugriff auf dieses Konto', noAccessDetail: 'Du hast keine Berechtigung für dieses Konto.',
  },
};

type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: Copy };
const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => localStorage.getItem('samly-language') === 'de' ? 'de' : 'en');
  const setLanguage = (next: Language) => setLanguageState(next);
  useEffect(() => { localStorage.setItem('samly-language', language); document.documentElement.lang = language; }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t: copy[language] }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
