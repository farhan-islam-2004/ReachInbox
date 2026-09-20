import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { SlackStatus, EmailCounts } from '../types';
import { SlackModal } from './SlackModal';
import { ONBLogo } from './ONBLogo';
import {
  Clock,
  Send,
  ChevronDown,
  MessageSquare,
  Activity,
  LogOut,
  ExternalLink,
} from 'lucide-react';

interface SidebarProps {
  counts: EmailCounts;
  onRefresh?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ counts, onRefresh }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [slackModalOpen, setSlackModalOpen] = useState(false);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const fetchSlackStatus = async () => {
    try {
      const data = await api.slack.getStatus();
      setSlackStatus(data);
    } catch {
      // Graceful fallback if slack status fails
    }
  };

  useEffect(() => {
    fetchSlackStatus();
  }, []);

  return (
    <>
      <aside className="w-64 bg-white flex flex-col h-screen flex-shrink-0 select-none">
        {/* Top Logo: ONB Pixel Logo matching Figma exactly */}
        <div className="px-6 pt-5 pb-3">
          <ONBLogo className="h-6 w-auto text-black" />
        </div>

        {/* User Profile Card */}
        <div className="px-5 mb-4 relative">
          <div
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="bg-[#f4f5f7] hover:bg-[#eceef2] rounded-2xl p-2.5 flex items-center justify-between cursor-pointer transition-colors"
          >
            <div className="flex items-center space-x-2.5 min-w-0">
              <img
                src={user?.avatar || '/oliver-avatar.png'}
                alt={user?.name ?? ''}
                className="w-8 h-8 rounded-full object-cover flex-shrink-0 bg-gray-200"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/oliver-avatar.png';
                }}
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-900 truncate">
                  {user?.name ?? ''}
                </div>
                <div className="text-[11px] text-gray-400 truncate">
                  {user?.email ?? ''}
                </div>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 ml-1" />
          </div>

          {/* User Dropdown Menu */}
          {userDropdownOpen && (
            <div className="absolute left-5 right-5 top-full mt-1.5 bg-white border border-gray-100 rounded-xl shadow-lg py-1.5 z-20 animate-in fade-in zoom-in-95">
              <div className="px-3 py-1 text-[11px] font-medium text-gray-400 border-b border-gray-50">
                Integration & Account
              </div>
              <button
                onClick={() => {
                  setUserDropdownOpen(false);
                  setSlackModalOpen(true);
                }}
                className="w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <MessageSquare className="w-3.5 h-3.5 text-[#4A154B]" />
                  <span>Slack Alerts</span>
                </div>
                <span
                  className={`w-2 h-2 rounded-full ${
                    slackStatus?.connected ? 'bg-emerald-500' : 'bg-gray-300'
                  }`}
                />
              </button>
              <a
                href="http://localhost:4000/admin/queues"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Activity className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Queue Monitor</span>
                </div>
                <ExternalLink className="w-3 h-3 text-gray-400" />
              </a>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => {
                  setUserDropdownOpen(false);
                  logout();
                }}
                className="w-full px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 flex items-center space-x-2 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>

        {/* Compose Button (Pill with Green Border) */}
        <div className="px-5 mb-6">
          <button
            onClick={() => navigate('/compose')}
            className="w-full py-2 px-4 rounded-full border border-[#00a63e] hover:bg-emerald-50/40 text-[#00a63e] text-center font-medium text-sm transition-all active:scale-[0.99]"
          >
            Compose
          </button>
        </div>

        {/* Navigation Links: CORE */}
        <nav className="flex-1 px-4 space-y-1">
          <div className="px-3 mb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            CORE
          </div>

          {/* Scheduled NavLink */}
          <NavLink
            to="/scheduled"
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'bg-[#e8f5e9] text-gray-900 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            <div className="flex items-center space-x-3">
              <Clock className="w-4 h-4 text-gray-700 stroke-[1.8]" />
              <span>Scheduled</span>
            </div>
            <span className="text-xs text-gray-500 font-normal">
              {counts.scheduled}
            </span>
          </NavLink>

          {/* Sent NavLink */}
          <NavLink
            to="/sent"
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'bg-[#e8f5e9] text-gray-900 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            <div className="flex items-center space-x-3">
              <Send className="w-4 h-4 text-gray-700 stroke-[1.8]" />
              <span>Sent</span>
            </div>
            <span className="text-xs text-gray-400 font-normal">
              {counts.sent}
            </span>
          </NavLink>
        </nav>
      </aside>

      <SlackModal
        isOpen={slackModalOpen}
        onClose={() => setSlackModalOpen(false)}
        onStatusChange={() => {
          fetchSlackStatus();
          if (onRefresh) onRefresh();
        }}
      />
    </>
  );
};
