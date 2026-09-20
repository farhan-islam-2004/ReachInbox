import React, { useState, useEffect } from 'react';
import { SlackStatus } from '../types';
import { api } from '../services/api';
import { MessageSquare, CheckCircle, AlertCircle, ExternalLink, X, RefreshCw } from 'lucide-react';

interface SlackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStatusChange?: () => void;
}

export const SlackModal: React.FC<SlackModalProps> = ({ isOpen, onClose, onStatusChange }) => {
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.slack.getStatus();
      setStatus(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch Slack status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  const handleConnect = () => {
    window.location.href = api.slack.getConnectUrl();
  };

  const handleDisconnect = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await api.slack.disconnect();
      await fetchStatus();
      if (onStatusChange) onStatusChange();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect Slack');
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-[#4A154B] flex items-center justify-center text-white font-bold text-sm">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 text-base">Slack Integration</h3>
              <p className="text-xs text-slate-500">Live delivery alerts & worker notifications</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-center space-x-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mb-2" />
              <p className="text-sm">Checking Slack integration status...</p>
            </div>
          ) : status?.connected ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                <div className="flex items-center space-x-2 text-emerald-700 font-medium text-sm mb-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>Connected to Slack</span>
                </div>
                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Workspace:</span>
                    <span className="font-semibold text-slate-800">{status.teamName || 'Workspace'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Notification Channel:</span>
                    <span className="font-semibold text-slate-800 font-mono">
                      #{status.channel || 'general'}
                    </span>
                  </div>
                  {status.configuredAt && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Connected Since:</span>
                      <span>{new Date(status.configuredAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-500 leading-relaxed">
                ReachInbox will automatically dispatch a Slack notification card whenever a scheduled email
                is successfully dispatched through SMTP.
              </div>

              <div className="pt-2 flex justify-end space-x-3">
                <button
                  onClick={handleDisconnect}
                  disabled={actionLoading}
                  className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Disconnecting...' : 'Disconnect'}
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mx-auto mb-1">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-semibold text-slate-800 text-sm">No Slack Workspace Connected</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  Connect your Slack workspace using OAuth 2.0 to receive automated real-time alerts when your
                  scheduled emails are sent.
                </p>
              </div>

              <div className="pt-3">
                <button
                  onClick={handleConnect}
                  className="w-full flex items-center justify-center space-x-2 bg-[#4A154B] hover:bg-[#3d113e] text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                  <span>Connect with Slack</span>
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
