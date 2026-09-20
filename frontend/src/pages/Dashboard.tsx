import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useOutletContext } from 'react-router-dom';
import { Email, EmailStatus } from '../types';
import { api } from '../services/api';
import { EmailDetailModal } from '../components/EmailDetailModal';
import { LayoutContextType } from '../layouts/AppLayout';
import {
  Clock,
  Search,
  RotateCw,
  Filter,
  Star,
  Inbox,
  X,
} from 'lucide-react';

export const Dashboard: React.FC = () => {
  const location = useLocation();
  const { refreshCounts } = useOutletContext<LayoutContextType>();

  const isSentTab = location.pathname.includes('/sent');
  const currentStatus: EmailStatus = isSentTab ? 'SENT' : 'SCHEDULED';

  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const loadEmails = useCallback(
    async (query = '') => {
      try {
        if (query.trim()) {
          const searchRes = await api.emails.search(query.trim(), currentStatus);
          setEmails(searchRes.data);
        } else {
          const listRes = await api.emails.list({ status: currentStatus, limit: 100 });
          setEmails(listRes.data);
        }
      } catch (err) {
        console.error('Failed to load emails:', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currentStatus]
  );

  useEffect(() => {
    setLoading(true);
    loadEmails(searchQuery);
  }, [loadEmails, searchQuery]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      loadEmails(val);
    }, 300);
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadEmails(searchQuery), refreshCounts()]);
  };

  const toggleStar = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Format recipient cleanly like in reference Figma screenshot (e.g. "John Smith", "Olive", "Sarah Wilson", "Support")
  const formatRecipient = (recipient: string) => {
    if (!recipient) return 'Recipient';
    if (!recipient.includes('@')) return recipient;
    const username = recipient.split('@')[0];
    const parts = username.split(/[._-]+/);
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  };

  // Format scheduled time like "Tue 9:15:12 AM" or "Thu 8:15:12 PM"
  const formatScheduledTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const day = d.toLocaleDateString('en-US', { weekday: 'short' });
      const time = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      return `${day} ${time}`;
    } catch {
      return dateStr;
    }
  };

  const displayedEmails = emails;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white p-6 sm:p-8 font-sans">
      {/* Top Search & Filter Bar matching Figma layout */}
      <div className="flex items-center space-x-3 mb-6">
        <div className="relative flex-1 max-w-xl">
          <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full pl-11 pr-9 py-2 bg-[#f4f5f7] rounded-full text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:bg-gray-100 transition-all border-0"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                loadEmails('');
              }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Action Funnel Icon matching Figma */}
        <button
          type="button"
          className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          title="Filter"
        >
          <Filter className="w-4 h-4 stroke-[1.8]" />
        </button>

        {/* Refresh Action Icon matching Figma */}
        <button
          type="button"
          onClick={handleManualRefresh}
          className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          title="Refresh"
        >
          <RotateCw className={`w-4 h-4 stroke-[1.8] ${refreshing ? 'animate-spin text-emerald-600' : ''}`} />
        </button>
      </div>

      {/* Main Email List View */}
      <div className="flex-1">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-gray-400">
            <RotateCw className="w-6 h-6 animate-spin mb-3 text-emerald-600" />
            <span className="text-xs text-gray-500 font-medium">Loading emails...</span>
          </div>
        ) : displayedEmails.length === 0 ? (
          <div className="py-24 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center mx-auto mb-3">
              <Inbox className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">
              {searchQuery
                ? 'No matching emails found'
                : isSentTab
                ? 'No sent emails yet'
                : 'No scheduled emails yet'}
            </h3>
            <p className="text-xs text-gray-400 max-w-xs mx-auto">
              {searchQuery
                ? 'Try a different keyword search.'
                : isSentTab
                ? 'Emails sent via ReachInbox will appear here.'
                : 'Emails scheduled for delivery will appear here.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {displayedEmails.map((email) => {
              const isStarred = starredIds.has(email.id);
              return (
                <div
                  key={email.id}
                  onClick={() => setSelectedEmail(email)}
                  className="py-3.5 px-2 flex items-center justify-between hover:bg-gray-50/70 cursor-pointer transition-colors group"
                >
                  {/* Left Row Content: Recipient + Time/Sent Pill + Subject + Body Preview */}
                  <div className="flex items-center space-x-4 min-w-0 flex-1 pr-4">
                    {/* Recipient Name in fixed column width for vertical badge alignment */}
                    <div className="w-44 sm:w-52 flex-shrink-0">
                      <span className="text-sm font-semibold text-gray-900 block truncate">
                        To: {formatRecipient(email.recipient)}
                      </span>
                    </div>

                    {/* Status / Time Pill matching reference screenshot */}
                    {isSentTab || email.status === 'SENT' ? (
                      <div className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#f3f4f6] text-gray-600 text-xs font-medium flex-shrink-0">
                        <span>Sent</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-[#fff3e0] text-[#e65100] border border-[#ffe0b2] text-xs font-medium flex-shrink-0">
                        <Clock className="w-3 h-3 text-[#f57c00] flex-shrink-0" />
                        <span>{formatScheduledTime(email.scheduledAt)}</span>
                      </div>
                    )}

                    {/* Subject + Dash + Body Preview */}
                    <div className="min-w-0 flex items-center space-x-2 truncate text-sm flex-1">
                      <span className="font-semibold text-gray-900 flex-shrink-0 max-w-[280px] sm:max-w-md truncate">
                        {email.subject}
                      </span>
                      <span className="text-gray-400 flex-shrink-0">-</span>
                      <span className="text-gray-400 truncate">
                        {(email.body ?? '').replace(/<[^>]*>?/gm, '')}
                      </span>
                    </div>
                  </div>

                  {/* Right Side Action: Star Outline Icon matching Figma */}
                  <div className="flex-shrink-0 pl-2">
                    <button
                      type="button"
                      onClick={(e) => toggleStar(email.id, e)}
                      className="p-1 transition-colors text-gray-300 hover:text-amber-400"
                      title={isStarred ? 'Starred' : 'Star this email'}
                    >
                      <Star
                        className={`w-4 h-4 stroke-[1.5] ${
                          isStarred ? 'text-amber-400 fill-amber-400' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Email Detail Dedicated View matching reference screenshot */}
      {selectedEmail && (
        <EmailDetailModal
          email={selectedEmail}
          onClose={() => setSelectedEmail(null)}
          onDelete={(id) => {
            setEmails((prev) => prev.filter((e) => e.id !== id));
          }}
          onToggleStar={(id) => {
            setStarredIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
        />
      )}
    </div>
  );
};
