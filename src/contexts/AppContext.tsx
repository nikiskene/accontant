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
  signOut: () => Promise<void>;
  refetchReferenceData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
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
    if (user && !workspaceId) {
      void loadWorkspace();
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

  const loadWorkspace = async () => {
    try {
      const { data: memberData, error: memberError } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user!.id)
        .maybeSingle();

      if (memberError) throw memberError;

      if (memberData) {
        setWorkspaceId(memberData.workspace_id);
      } else {
        const workspaceIdToUse = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9';

        const { error: insertError } = await supabase.from('workspace_members').insert({
          workspace_id: workspaceIdToUse,
          user_id: user!.id,
          role: 'admin',
        });

        if (insertError) throw insertError;
        setWorkspaceId(workspaceIdToUse);
      }
    } catch (error) {
      console.error('Error loading workspace:', error);
      setLoading(false);
    }
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
        const defaultYear =
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