import React, { useState, useEffect, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { api } from '../services/api';
import { EmailCounts } from '../types';

export interface LayoutContextType {
  counts: EmailCounts;
  refreshCounts: () => Promise<void>;
}

export const AppLayout: React.FC = () => {
  const [counts, setCounts] = useState<EmailCounts>({ scheduled: 0, sent: 0 });

  const refreshCounts = useCallback(async () => {
    try {
      const res = await api.emails.list({ limit: 1 });
      if (res.counts) {
        setCounts(res.counts);
      }
    } catch {
      // Ignored if user not authenticated or network error
    }
  }, []);

  useEffect(() => {
    refreshCounts();
    // Poll counts every 10 seconds to keep tabs live as workers process jobs
    const interval = setInterval(refreshCounts, 10000);
    return () => clearInterval(interval);
  }, [refreshCounts]);

  return (
    <div className="flex h-screen bg-white overflow-hidden font-sans">
      <Sidebar counts={counts} onRefresh={refreshCounts} />
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-white">
        <Outlet context={{ counts, refreshCounts }} />
      </main>
    </div>
  );
};
