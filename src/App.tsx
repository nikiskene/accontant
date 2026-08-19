import { useState, useEffect } from 'react';
import { AppProvider, useApp } from './contexts/AppContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { NewSale } from './pages/NewSale';
import { NewExpense } from './pages/NewExpense';
import { Transactions } from './pages/Transactions';
import { Trips } from './pages/Trips';
import { BankInbox } from './pages/BankInbox';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { AuditLog } from './pages/AuditLog';
import { Customers } from './pages/Customers';
import { CustomerDetail } from './pages/CustomerDetail';
import { CustomerImport } from './pages/CustomerImport';
import { CompanySwitcher } from './pages/CompanySwitcher';
import { Catalog } from './pages/Catalog';
import { SalesDocuments } from './pages/SalesDocuments';
import { CompanyProfile } from './pages/CompanyProfile';
import { NewQuote } from './pages/NewQuote';
import { Suppliers } from './pages/Suppliers';
import { CompanyBanks } from './pages/CompanyBanks';
import { SalesDocumentDetail } from './pages/SalesDocumentDetail';
import { Receivables } from './pages/Receivables';
import { SupplierInvoices } from './pages/SupplierInvoices';
import { NewSupplierInvoice } from './pages/NewSupplierInvoice';
import { AustrianTaxSetup } from './pages/AustrianTaxSetup';
import { FixedAssets } from './pages/FixedAssets';
import { StatementImports } from './pages/StatementImports';
import { DocumentTemplates } from './pages/DocumentTemplates';
import { PrivateInsolvency } from './pages/PrivateInsolvency';
import { CorrectInvoice } from './pages/CorrectInvoice';

function Router() {
  const { user, loading } = useApp();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const getPage = () => {
    if (currentPath.startsWith('/sales-documents/')) return <SalesDocumentDetail id={currentPath.split('/')[2]} />;
    if (currentPath.startsWith('/customers/')) {
      const customerId = currentPath.split('/')[2];
      if (customerId === 'import') {
        return <CustomerImport />;
      }
      return <CustomerDetail customerId={customerId} />;
    }

    switch (currentPath) {
      case '/dashboard':
        return <Dashboard />;
      case '/companies':
        return <CompanySwitcher />;
      case '/catalog':
        return <Catalog />;
      case '/sales-documents':
        return <SalesDocuments />;
      case '/new-quote':
        return <NewQuote />;
      case '/correct-invoice':
        return <CorrectInvoice />;
      case '/company-profile':
        return <CompanyProfile />;
      case '/suppliers':
        return <Suppliers />;
      case '/company-banks':
        return <CompanyBanks />;
      case '/receivables':
        return <Receivables />;
      case '/supplier-invoices':
        return <SupplierInvoices />;
      case '/new-supplier-invoice':
        return <NewSupplierInvoice />;
      case '/austrian-tax-setup':
        return <AustrianTaxSetup />;
      case '/fixed-assets':
        return <FixedAssets />;
      case '/statement-imports':
        return <StatementImports />;
      case '/document-templates':
        return <DocumentTemplates />;
      case '/new-sale':
        return <NewSale />;
      case '/new-expense':
        return <NewExpense />;
      case '/transactions':
        return <Transactions />;
      case '/trips':
        return <Trips />;
      case '/bank-inbox':
        return <BankInbox />;
      case '/customers':
        return <Customers />;
      case '/reports':
        return <Reports />;
      case '/settings':
        return <Settings />;
      case '/audit-log':
        return <AuditLog />;
      case '/private-insolvency':
        return <PrivateInsolvency />;
      default:
        window.history.pushState({}, '', '/companies');
        return <CompanySwitcher />;
    }
  };

  return <Layout>{getPage()}</Layout>;
}

function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}

export default App;
