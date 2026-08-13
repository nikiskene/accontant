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
  Home,
  MoreHorizontal,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import { Button } from './Button';
import { Select } from './Select';

interface LayoutProps {
  children: ReactNode;
}

interface NavItem {
  name: string;
  icon: LucideIcon;
  path: string;
  country?: string;
  section: 'Company' | 'Sales' | 'Costs' | 'Accounting';
}

const navItems: NavItem[] = [
  { name: 'Companies', icon: Building2, path: '/companies', section: 'Company' },
  { name: 'Company Credentials', icon: Building2, path: '/company-profile', section: 'Company' },
  { name: 'Company Bank Details', icon: Building2, path: '/company-banks', section: 'Company' },
  { name: 'Tax Years', icon: ClipboardList, path: '/austrian-tax-setup', section: 'Company' },
  { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', section: 'Accounting' },
  { name: 'Quotes & Invoices', icon: Files, path: '/sales-documents', section: 'Sales' },
  { name: 'Receivables', icon: Files, path: '/receivables', section: 'Sales' },
  { name: 'Products & Services', icon: Package, path: '/catalog', section: 'Sales' },
  { name: 'Customers', icon: Users, path: '/customers', section: 'Sales' },
  { name: 'Document Layouts', icon: FileText, path: '/document-templates', section: 'Sales' },
  { name: 'New Sale', icon: Plus, path: '/new-sale', section: 'Sales' },
  { name: 'New Expense', icon: Receipt, path: '/new-expense', section: 'Costs' },
  { name: 'Trips', icon: Plane, path: '/trips', section: 'Costs' },
  { name: 'Suppliers', icon: Users, path: '/suppliers', section: 'Costs' },
  { name: 'Supplier Invoices', icon: Receipt, path: '/supplier-invoices', section: 'Costs' },
  { name: 'Bank Inbox', icon: Inbox, path: '/bank-inbox', section: 'Accounting' },
  { name: 'Statement Imports', icon: Inbox, path: '/statement-imports', section: 'Accounting' },
  { name: 'Transactions', icon: FileText, path: '/transactions', section: 'Accounting' },
  { name: 'Reports', icon: ClipboardList, path: '/reports', section: 'Accounting' },
  { name: 'Fixed Assets & AfA', icon: ClipboardList, path: '/fixed-assets', country: 'AT', section: 'Accounting' },
  { name: 'Settings', icon: Settings, path: '/settings', section: 'Accounting' },
  { name: 'Audit Log', icon: FileText, path: '/audit-log', section: 'Accounting' },
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
                <h1 className="text-xl font-bold">Accountant Niki SKENE</h1>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-4">
              {navItems.filter(item => !item.country || item.country === workspace?.country).map((item, index, visible) => {
                const Icon = item.icon;
                const isActive = currentPath === item.path;
                return (
                  <div key={item.path}>{(index===0||visible[index-1].section!==item.section)&&<p className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{item.section}</p>}<button
                    onClick={() => handleNavigation(item.path)}
                    className={`flex items-center w-full px-4 py-2.5 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5 mr-3" />
                    <span className="font-medium">{item.name}</span>
                  </button></div>
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
          <header className="bg-white border-b border-gray-200 px-3 py-2 sm:px-4 sm:py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="text-gray-600 hover:text-gray-900 lg:hidden"
                >
                  <Menu className="w-6 h-6" />
                </button>
                <h2 className="ml-3 text-base font-semibold text-gray-900 lg:hidden">Accountant Niki SKENE</h2>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
              {workspaces.length > 0 && <Select value={workspaceId || ''} onChange={(e) => selectWorkspace(e.target.value)} className="max-w-[135px] sm:max-w-none sm:min-w-[210px]">
                {workspaces.map(company => <option key={company.id} value={company.id}>{company.trade_name || company.legal_name}</option>)}
              </Select>}
              {taxYears.length > 0 && (
                <div className="hidden items-center gap-2 sm:flex">
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

          <main className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-6">
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
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-white px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_16px_rgba(0,0,0,.08)] lg:hidden">
        {[{name:'Home',icon:Home,path:'/dashboard'},{name:'Sales',icon:ShoppingCart,path:'/sales-documents'},{name:'Costs',icon:Receipt,path:'/new-expense'}].map(item=>{const Icon=item.icon;const active=currentPath===item.path;return <button key={item.path} onClick={()=>handleNavigation(item.path)} className={`flex flex-col items-center gap-1 rounded-lg py-1 text-xs ${active?'text-blue-700':'text-gray-500'}`}><Icon className="h-5 w-5"/><span>{item.name}</span></button>})}
        <button onClick={()=>setSidebarOpen(true)} className="flex flex-col items-center gap-1 rounded-lg py-1 text-xs text-gray-500"><MoreHorizontal className="h-5 w-5"/><span>More</span></button>
      </nav>
    </div>
  );
}
