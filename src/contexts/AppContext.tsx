// src/contexts/AppContext.tsx

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  Workspace,
  WorkspaceSettings,
  Account,
  VatCode,
  CostCenter,
  Counterparty,
  TaxYear,
} from '../lib/types';

interface AppContextType {
  user: User | null;
  workspaces: Workspace[];
  workspaceId: string | null;
  workspace: Workspace | null;
  workspaceSettings: WorkspaceSettings | null;
  accounts: Account[];
  vatCodes: VatCode[];
  costCenters: CostCenter[];
  counterparties: Counterparty[];
  taxYears: TaxYear[];

  // canonical selection
  selectedTaxYearId: string | null;
  setSelectedTaxYearId: (id: string | null) => void;

  // aliases (so older/newer pages can use either naming)
  taxYearId: string | null;
  setTaxYearId: (id: string | null) => void;

  loading: boolean;
  hasWorkspaceAccess: boolean;
  selectWorkspace: (id: string) => void;
  signOut: () => Promise<void>;
  refetchReferenceData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vatCodes, setVatCodes] = useState<VatCode[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [taxYears, setTaxYears] = useState<TaxYear[]>([]);
  const [selectedTaxYearId, setSelectedTaxYearId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasWorkspaceAccess, setHasWorkspaceAccess] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      void loadWorkspaces();
    } else if (!user) {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (workspaceId) {
      void loadReferenceData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const loadWorkspaces = async () => {
    try {
      const { data: memberData, error: memberError } = await supabase
        .from('workspace_members')
        .select('workspace_id, workspaces(*)')
        .eq('user_id', user!.id);

      if (memberError) throw memberError;

      const available = (memberData || [])
        .map((row: any) => row.workspaces as Workspace | null)
        .filter((item): item is Workspace => Boolean(item));
      setWorkspaces(available);
      const saved = localStorage.getItem('accounting-workspace-id');
      const initial = available.find((item) => item.id === saved) || available[0] || null;
      setWorkspaceId(initial?.id || null);
      if (!initial) setLoading(false);
    } catch (error) {
      console.error('Error loading workspace:', error);
      setLoading(false);
    }
  };

  const selectWorkspace = (id: string) => {
    if (!workspaces.some((item) => item.id === id)) return;
    localStorage.setItem('accounting-workspace-id', id);
    setSelectedTaxYearId(null);
    setWorkspaceId(id);
  };

  const loadReferenceData = async () => {
    try {
      setLoading(true);

      const [
        { data: workspaceData, error: workspaceError },
        { data: settingsData },
        { data: accountsData },
        { data: vatCodesData },
        { data: costCentersData },
        { data: counterpartiesData },
        { data: taxYearsData },
      ] = await Promise.all([
        supabase.from('workspaces').select('*').eq('id', workspaceId).single(),
        supabase.from('workspace_settings').select('*').eq('workspace_id', workspaceId).single(),
        supabase
          .from('accounts')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('is_active', true)
          .order('code'),
        supabase.from('vat_codes').select('*').eq('workspace_id', workspaceId).order('code'),
        supabase
          .from('cost_centers')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('is_active', true)
          .order('code'),
        supabase.from('counterparties').select('*').eq('workspace_id', workspaceId).order('name').limit(200),
        supabase.from('tax_years').select('*').eq('workspace_id', workspaceId).order('label', { ascending: false }),
      ]);

      if (workspaceError) {
        setHasWorkspaceAccess(false);
      } else {
        setHasWorkspaceAccess(true);
      }

      setWorkspace(workspaceData);
      setWorkspaceSettings(settingsData);
      setAccounts(accountsData || []);
      setVatCodes(vatCodesData || []);
      setCostCenters(costCentersData || []);
      setCounterparties(counterpartiesData || []);
      setTaxYears(taxYearsData || []);

      // Only set a default if nothing is selected yet.
      if (taxYearsData && taxYearsData.length > 0 && !selectedTaxYearId) {
        const currentYear = String(new Date().getFullYear());
        const defaultYear =
          taxYearsData.find((ty) => ty.label === currentYear) ||
          taxYearsData.find((ty) => ty.is_default) ||
          taxYearsData[0];

        if (defaultYear) setSelectedTaxYearId(defaultYear.id);
      }
    } catch (error) {
      console.error('Error loading reference data:', error);
      setHasWorkspaceAccess(false);
    } finally {
      setLoading(false);
    }
  };

  const refetchReferenceData = async () => {
    if (workspaceId) await loadReferenceData();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setWorkspaceId(null);
    setWorkspaces([]);
    setWorkspace(null);
    setWorkspaceSettings(null);
    setAccounts([]);
    setVatCodes([]);
    setCostCenters([]);
    setCounterparties([]);
    setTaxYears([]);
    setSelectedTaxYearId(null);
  };

  return (
    <AppContext.Provider
      value={{
        user,
        workspaces,
        workspaceId,
        workspace,
        workspaceSettings,
        accounts,
        vatCodes,
        costCenters,
        counterparties,
        taxYears,

        // canonical
        selectedTaxYearId,
        setSelectedTaxYearId,

        // aliases
        taxYearId: selectedTaxYearId,
        setTaxYearId: setSelectedTaxYearId,

        loading,
        hasWorkspaceAccess,
        selectWorkspace,
        signOut,
        refetchReferenceData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
