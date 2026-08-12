import { ReactNode, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import {
  LayoutDashboard,
  Plus,
  Receipt,
  Plane,
  Inbox,
  FileText,
  Settings,
  ClipboardList,
  LogOut,
  Menu,
  X,
  AlertCircle,
  Users,
  Building2,
  Package,
  Files,
} from 'lucide-react';
import { Button } from './Button';
import { Select } from './Select';

interface LayoutProps {
  children: ReactNode;
}

interface NavItem {
  name: string;
  icon: any;
  path: string;
}

const navItems: NavItem[] = [
  { name: 'Companies', icon: Building2, path: '/companies' },
  { name: 'Company Credentials', icon: Building2, path: '/company-profile' },
  { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { name: 'Quotes & Invoices', icon: Files, path: '/sales-documents' },
  { name: 'Products & Services', icon: Package, path: '/catalog' },
  { name: 'New Sale', icon: Plus, path: '/new-sale' },
  { name: 'New Expense', icon: Receipt, path: '/new-expense' },
  { name: 'Transactions', icon: FileText, path: '/transactions' },
  { name: 'Trips', icon: Plane, path: '/trips' },
  { name: 'Customers', icon: Users, path: '/customers' },
  { name: 'Bank Inbox', icon: Inbox, path: '/bank-inbox' },
  { name: 'Reports', icon: ClipboardList, path: '/reports' },
  { name: 'Settings', icon: Settings, path: '/settings' },
  { name: 'Audit Log', icon: FileText, path: '/audit-log' },
];

export function Layout({ children }: LayoutProps) {
  const { workspace, workspaces, workspaceId, selectWorkspace, taxYears, selectedTaxYearId, setSelectedTaxYearId, hasWorkspaceAccess, signOut } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentPath = window.location.pathname;

  const handleNavigation = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex h-screen overflow-hidden">
        <aside
          className={`${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 text-white transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0`}
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <div>
                <h1 className="text-xl font-bold">IACy Tax Ledger</h1>
                {workspace && (
                  <p className="text-xs text-gray-400 mt-1">{workspace.trade_name || workspace.legal_name}</p>
                )}
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentPath === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavigation(item.path)}
                    className={`flex items-center w-full px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5 mr-3" />
                    <span className="font-medium">{item.name}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-gray-800">
              <Button
                variant="ghost"
                className="w-full justify-start text-gray-300 hover:text-white hover:bg-gray-800"
                onClick={signOut}
              >
                <LogOut className="w-5 h-5 mr-3" />
                Sign Out
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="text-gray-600 hover:text-gray-900 lg:hidden"
                >
                  <Menu className="w-6 h-6" />
                </button>
                <h2 className="ml-4 text-lg font-semibold text-gray-900 lg:hidden">IACy Tax Ledger</h2>
              </div>

              <div className="flex items-center gap-3">
              {workspaces.length > 0 && <Select value={workspaceId || ''} onChange={(e) => selectWorkspace(e.target.value)} className="min-w-[210px]">
                {workspaces.map(company => <option key={company.id} value={company.id}>{company.trade_name || company.legal_name}</option>)}
              </Select>}
              {taxYears.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 hidden lg:inline">Tax Year:</span>
                  <Select
                    value={selectedTaxYearId || ''}
                    onChange={(e) => setSelectedTaxYearId(e.target.value)}
                    className="w-auto min-w-[120px]"
                  >
                    {taxYears.map((ty) => (
                      <option key={ty.id} value={ty.id}>
                        {ty.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-6">
            {!hasWorkspaceAccess && (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-900">No Access to Workspace</h3>
                  <p className="text-sm text-red-800 mt-1">
                    You don't have permission to access this workspace. Please contact your administrator.
                  </p>
                </div>
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
