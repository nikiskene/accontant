import { Building2, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '../contexts/AppContext';

export function CompanySwitcher() {
  const { workspaces, workspaceId, selectWorkspace } = useApp();

  const open = (id: string) => {
    selectWorkspace(id);
    window.history.pushState({}, '', '/dashboard');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="max-w-5xl mx-auto py-10">
      <div className="mb-8">
        <p className="text-sm font-semibold text-blue-600 uppercase tracking-wide">Accounting platform</p>
        <h1 className="text-4xl font-bold text-gray-950 mt-2">Choose a company</h1>
        <p className="text-gray-600 mt-2">Each legal entity has its own ledger, tax settings, documents and numbering.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {workspaces.map((company) => (
          <button key={company.id} onClick={() => open(company.id)}
            className="text-left bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:border-blue-400 hover:shadow-md transition">
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
                <Building2 className="w-6 h-6" />
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
            <h2 className="text-xl font-semibold mt-5">{company.trade_name || company.legal_name}</h2>
            <p className="text-sm text-gray-500 mt-1">{company.country} · {company.base_currency}</p>
            {company.id === workspaceId && <p className="text-xs text-blue-600 mt-4">Last opened</p>}
          </button>
        ))}
        <div className="border border-dashed border-gray-300 rounded-2xl p-6 text-gray-500">
          <Plus className="w-6 h-6 mb-4" />
          <p className="font-medium text-gray-700">Add legal entity</p>
          <p className="text-sm mt-1">Created by an administrator after its chart of accounts and tax setup are reviewed.</p>
        </div>
      </div>
    </div>
  );
}
