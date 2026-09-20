import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Sender } from '../types';
import { api, ApiError } from '../services/api';
import { LayoutContextType } from '../layouts/AppLayout';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  Calendar,
  ChevronDown,
  X,
  Undo,
  Redo,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  ChevronsUpDown,
  ListOrdered,
  List,
  Indent,
  Outdent,
  Quote,
  Link as LinkIcon,
  Strikethrough,
  FileText,
  AlertCircle,
  CheckCircle,
  Upload,
} from 'lucide-react';

interface AttachedFile {
  name: string;
  size: string;
  file: File;
  previewUrl?: string;
  isImage?: boolean;
  base64Data?: string;
}

export const Compose: React.FC = () => {
  const navigate = useNavigate();
  const outletContext = useOutletContext<LayoutContextType | null>();
  const refreshCounts = outletContext?.refreshCounts || (async () => {});

  // Senders state
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [showSenderDropdown, setShowSenderDropdown] = useState(false);
  const [sendersLoading, setSendersLoading] = useState(true);

  // Multi-recipient state
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRemainingPopover, setShowRemainingPopover] = useState(false);
  const recipientInputRef = useRef<HTMLInputElement>(null);

  // Email form fields
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Rate-limiting & delay controls matching Figma
  const [delaySeconds, setDelaySeconds] = useState('02');
  const [hourlyLimit, setHourlyLimit] = useState('50');

  // "Send Later" panel state
  const [showSendLater, setShowSendLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [tempScheduledAt, setTempScheduledAt] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);

  // Attachments state
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CSV / Text recipient list upload ref
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Date & Time picker input ref
  const dateTimeInputRef = useRef<HTMLInputElement>(null);

  // Status & loading
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch verified user senders
  useEffect(() => {
    const fetchSenders = async () => {
      try {
        setSendersLoading(true);
        const res = await api.emails.listSenders();
        setSenders(res.data);
        if (res.data.length > 0) {
          setSelectedSenderId(res.data[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch senders:', err);
      } finally {
        setSendersLoading(false);
      }
    };
    fetchSenders();

    // Default scheduled time preset for tomorrow at 10:00 AM
    const tomorrow10 = new Date();
    tomorrow10.setDate(tomorrow10.getDate() + 1);
    tomorrow10.setHours(10, 0, 0, 0);
    const localIso = new Date(tomorrow10.getTime() - tomorrow10.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setTempScheduledAt(localIso);
  }, []);

  // Cleanup object URLs when unmounting or attachments change
  useEffect(() => {
    return () => {
      attachments.forEach((att) => {
        if (att.previewUrl && att.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(att.previewUrl);
        }
      });
    };
  }, [attachments]);

  // Selected sender object
  const selectedSender = useMemo(() => {
    return senders.find((s) => s.id === selectedSenderId) || senders[0];
  }, [senders, selectedSenderId]);

  const selectedSenderEmail = selectedSender?.email ?? '';

  // Helper to validate and add an individual recipient email
  const addRecipient = (rawEmail: string): boolean => {
    const trimmed = rawEmail.trim().replace(/^[,\s;]+|[,\s;]+$/g, '');
    if (!trimmed) return false;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setError(`"${trimmed}" is not a valid email address.`);
      return false;
    }

    const normalized = trimmed.toLowerCase();
    if (recipients.includes(normalized)) {
      setError(`"${normalized}" is already in the recipient list.`);
      return false;
    }

    setRecipients((prev) => [...prev, normalized]);
    setRecipientInput('');
    setError(null);
    return true;
  };

  const removeRecipient = (indexToRemove: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  // Keyboard navigation & parsing in recipient input
  const handleRecipientKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      if (recipientInput.trim()) {
        e.preventDefault();
        addRecipient(recipientInput);
      }
    } else if (e.key === 'Backspace' && !recipientInput && recipients.length > 0) {
      // Remove last recipient on backspace if input is empty
      removeRecipient(recipients.length - 1);
    }
  };

  const handleRecipientBlur = () => {
    if (recipientInput.trim()) {
      addRecipient(recipientInput);
    }
  };

  const handleRecipientPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasteText = e.clipboardData.getData('text');
    if (pasteText) {
      const matches = pasteText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (matches && matches.length > 0) {
        e.preventDefault();
        const uniqueNew = Array.from(new Set(matches.map((m) => m.trim().toLowerCase()))).filter(
          (email) => !recipients.includes(email)
        );
        if (uniqueNew.length > 0) {
          setRecipients((prev) => [...prev, ...uniqueNew]);
          setRecipientInput('');
          setError(null);
        }
      }
    }
  };

  // Visible recipients calculation for "+N" collapsing
  const maxVisibleChips = 3;
  const hasHiddenRecipients = recipients.length > maxVisibleChips;
  const visibleRecipients = isExpanded
    ? recipients
    : recipients.slice(0, maxVisibleChips);

  // Formatting helpers for the editor toolbar
  const applyFormat = (prefix: string, suffix: string = '') => {
    const textarea = document.getElementById('compose-body-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = body.substring(start, end);
    const replacement = `${prefix}${selectedText || 'text'}${suffix}`;

    const newBody = body.substring(0, start) + replacement + body.substring(end);
    setBody(newBody);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + (selectedText.length || 4)
      );
    }, 50);
  };

  // Quick schedule presets
  const setSchedulePreset = (type: 'now' | 'tomorrow_9' | 'tomorrow_10' | 'tomorrow_11' | 'tomorrow_15') => {
    if (type === 'now') {
      setTempScheduledAt('now');
      return;
    }

    const d = new Date();
    d.setDate(d.getDate() + 1);

    if (type === 'tomorrow_9') d.setHours(9, 0, 0, 0);
    else if (type === 'tomorrow_10') d.setHours(10, 0, 0, 0);
    else if (type === 'tomorrow_11') d.setHours(11, 0, 0, 0);
    else if (type === 'tomorrow_15') d.setHours(15, 0, 0, 0);

    const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setTempScheduledAt(localIso);
  };

  // Confirm schedule selection from panel
  const handleConfirmSchedule = () => {
    if (!tempScheduledAt) {
      setError('Please select a valid future date and time.');
      return;
    }

    if (tempScheduledAt === 'now') {
      setScheduledAt('now');
      setIsScheduled(false);
      setShowSendLater(false);
      setError(null);
      return;
    }

    const chosen = new Date(tempScheduledAt);
    if (isNaN(chosen.getTime()) || chosen.getTime() <= Date.now()) {
      setError('Scheduled time must be a valid future timestamp.');
      return;
    }
    setScheduledAt(tempScheduledAt);
    setIsScheduled(true);
    setShowSendLater(false);
    setError(null);
  };

  // Clear active schedule
  const handleClearSchedule = () => {
    setIsScheduled(false);
    setScheduledAt('');
  };

  // Handle file attachment selection with Base64 encoding for persistence
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      selected.forEach((f) => {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        const isImg = f.type.startsWith('image/');
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          setAttachments((prev) => [
            ...prev,
            {
              name: f.name,
              size: f.size > 1024 * 1024 ? `${sizeMb} MB` : `${Math.round(f.size / 1024)} KB`,
              file: f,
              isImage: isImg,
              previewUrl: dataUrl,
              base64Data: dataUrl,
            },
          ]);
        };
        reader.readAsDataURL(f);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const item = prev[index];
      if (item?.previewUrl && item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  // Handle CSV / text list upload
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text || !text.trim()) {
          setError(`File "${file.name}" is empty.`);
          return;
        }

        // Match all email patterns inside the uploaded CSV/text file
        const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (!matches || matches.length === 0) {
          setError(`No valid email addresses found in "${file.name}".`);
          return;
        }

        // Deduplicate and filter out already added recipients
        const uniqueParsed = Array.from(new Set(matches.map((m) => m.trim().toLowerCase())));
        const newRecipients = uniqueParsed.filter((email) => !recipients.includes(email));

        if (newRecipients.length === 0) {
          setError(`All ${uniqueParsed.length} email addresses in "${file.name}" are already in the recipient list.`);
          return;
        }

        setRecipients((prev) => [...prev, ...newRecipients]);
        setSuccessMessage(
          `Added ${newRecipients.length} new recipient${newRecipients.length > 1 ? 's' : ''} from "${file.name}".`
        );
        setError(null);
      } catch (err: any) {
        setError(`Failed to parse "${file.name}": ${err.message || 'Unknown error'}`);
      }
    };

    reader.onerror = () => {
      setError(`Failed to read file "${file.name}".`);
    };

    reader.readAsText(file);
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  // Format display string for scheduled badge
  const getScheduledBadgeText = () => {
    if (!scheduledAt) return '';
    if (scheduledAt === 'now') return 'Immediate Send';
    try {
      const d = new Date(scheduledAt);
      const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${day}, ${time}`;
    } catch {
      return scheduledAt;
    }
  };

  // Submit & schedule email through real backend APIs
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Automatically incorporate any pending text in the input
    let finalRecipients = [...recipients];
    if (recipientInput.trim()) {
      const trimmed = recipientInput.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(trimmed) && !finalRecipients.includes(trimmed)) {
        finalRecipients.push(trimmed);
        setRecipients(finalRecipients);
        setRecipientInput('');
      }
    }

    if (finalRecipients.length === 0) {
      setError('Please provide at least one valid recipient email address.');
      return;
    }
    if (!subject.trim()) {
      setError('Subject line is required.');
      return;
    }
    if (!body.trim()) {
      setError('Email body is required.');
      return;
    }

    // Determine execution timestamp
    let baseTime: Date;
    if (isScheduled && scheduledAt && scheduledAt !== 'now') {
      baseTime = new Date(scheduledAt);
      if (isNaN(baseTime.getTime()) || baseTime.getTime() <= Date.now()) {
        setError('Scheduled date must be a valid future timestamp.');
        return;
      }
    } else {
      // Immediate send: scheduled for +3 seconds from now to allow BullMQ worker pickup
      baseTime = new Date(Date.now() + 3000);
    }

    try {
      setLoading(true);

      const delayVal = Math.max(2, parseInt(delaySeconds, 10) || 2);

      const preparedAttachments = attachments.map((att) => ({
        filename: att.name,
        size: att.size,
        contentType: att.file.type || (att.isImage ? 'image/png' : 'application/octet-stream'),
        data: att.base64Data,
        previewUrl: att.previewUrl,
        url: att.previewUrl,
      }));

      if (finalRecipients.length === 1) {
        // Single recipient delivery
        const targetEmail = finalRecipients[0];

        await api.emails.schedule({
          recipient: targetEmail,
          subject: subject.trim(),
          body: body.trim(),
          scheduledAt: baseTime.toISOString(),
          senderId: selectedSenderId || undefined,
          attachments: preparedAttachments.length > 0 ? preparedAttachments : undefined,
        });

        setSuccessMessage(
          isScheduled
            ? `Email scheduled for ${targetEmail} on ${getScheduledBadgeText()}!`
            : `Email queued for immediate delivery to ${targetEmail}!`
        );
      } else {
        // Multi-recipient batch delivery: Each email is an individual PostgreSQL and BullMQ job
        const batchEmails = finalRecipients.map((rec, idx) => {
          const itemTime = new Date(baseTime.getTime() + idx * delayVal * 1000);
          return {
            recipient: rec,
            subject: subject.trim(),
            body: body.trim(),
            scheduledAt: itemTime.toISOString(),
            senderId: selectedSenderId || undefined,
            attachments: preparedAttachments.length > 0 ? preparedAttachments : undefined,
          };
        });

        const res = await api.emails.scheduleBatch({ emails: batchEmails });
        setSuccessMessage(
          `Successfully scheduled batch of ${res.scheduled} individual email jobs via BullMQ!`
        );
      }

      await refreshCounts();

      // Navigate back to scheduled list
      setTimeout(() => {
        navigate('/scheduled');
      }, 1200);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err.message || 'Failed to schedule email.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Primary action button click handler
  const handlePrimaryButtonClick = () => {
    if (isScheduled || scheduledAt === 'now') {
      handleSubmit();
    } else {
      // If user hasn't selected a schedule time yet, open the Send Later panel
      setShowSendLater(true);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white min-h-screen font-sans relative">
      {/* Hidden file input for attachment handling */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        multiple
        className="hidden"
      />

      {/* Hidden file input for CSV/Text recipient list upload */}
      <input
        type="file"
        ref={csvInputRef}
        onChange={handleCsvUpload}
        accept=".csv, .txt, text/csv, text/plain"
        className="hidden"
      />

      {/* Top Header matching reference screenshot */}
      <header className="px-6 sm:px-10 py-4 flex items-center justify-between border-b border-gray-100 bg-white sticky top-0 z-20">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1.5 text-gray-700 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors -ml-1.5"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[1.8]" />
          </button>
          <h1 className="text-base sm:text-lg font-normal text-gray-900">
            Compose New Email
          </h1>
        </div>

        {/* Top-right Actions: Attachment, Clock, Send Later */}
        <div className="flex items-center space-x-3">
          {/* Active Schedule Badge Pill if configured */}
          {isScheduled && (
            <div className="hidden sm:inline-flex items-center space-x-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-full text-xs font-medium animate-in fade-in">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>{getScheduledBadgeText()}</span>
              <button
                type="button"
                onClick={handleClearSchedule}
                className="text-emerald-700 hover:text-emerald-900 ml-1"
                title="Clear schedule"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Attachment Icon with badge when files attached */}
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`p-2 rounded-full transition-colors flex items-center space-x-0.5 ${
                attachments.length > 0
                  ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/60'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
              }`}
              title="Attach files or image"
            >
              <Paperclip className="w-5 h-5 stroke-[1.8]" />
              {attachments.length > 0 && (
                <span className="text-[11px] font-bold text-emerald-600 pl-0.5">
                  {attachments.length}
                </span>
              )}
            </button>
          </div>

          {/* Schedule / Clock Icon */}
          <button
            type="button"
            onClick={() => {
              setShowSendLater(!showSendLater);
              setShowSenderDropdown(false);
            }}
            className={`p-2 rounded-full transition-colors ${
              isScheduled
                ? 'text-emerald-600 bg-emerald-50'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
            }`}
            title="Send Later (Schedule)"
          >
            <Clock className="w-5 h-5 stroke-[1.8]" />
          </button>

          {/* Send Later Button (Green outlined pill matching screenshot) */}
          <button
            type="button"
            onClick={handlePrimaryButtonClick}
            disabled={loading}
            className="px-5 py-1.5 rounded-full border border-[#00a63e] hover:bg-emerald-50/40 text-[#00a63e] font-medium text-sm transition-all active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? 'Scheduling...' : scheduledAt === 'now' ? 'Send Now' : 'Send Later'}
          </button>
        </div>
      </header>

      {/* Floating "Send Later" Panel matching reference screenshot */}
      {showSendLater && (
        <div className="absolute right-6 sm:right-10 top-16 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 p-5 z-40 animate-in fade-in zoom-in-95">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Send Later</h3>

          {/* Date & Time Picker */}
          <div className="relative border-b border-gray-200 pb-2 mb-4 flex items-center justify-between">
            <input
              ref={dateTimeInputRef}
              type="datetime-local"
              value={tempScheduledAt === 'now' ? '' : tempScheduledAt}
              onChange={(e) => setTempScheduledAt(e.target.value)}
              className="text-xs text-gray-700 bg-transparent focus:outline-none w-full pr-6 [&::-webkit-calendar-picker-indicator]:hidden"
            />
            <button
              type="button"
              onClick={() => {
                if (dateTimeInputRef.current && typeof dateTimeInputRef.current.showPicker === 'function') {
                  dateTimeInputRef.current.showPicker();
                } else {
                  dateTimeInputRef.current?.focus();
                }
              }}
              className="text-gray-400 hover:text-gray-600 transition-colors absolute right-1 top-1/2 -translate-y-1/2 focus:outline-none cursor-pointer"
              title="Open calendar"
            >
              <Calendar className="w-4 h-4" />
            </button>
          </div>

          {/* Quick preset options */}
          <div className="space-y-1 mb-6">
            <div
              onClick={() => setSchedulePreset('now')}
              className="py-1.5 px-2 text-xs text-gray-600 hover:text-emerald-700 hover:bg-emerald-50/50 rounded-lg cursor-pointer transition-colors flex items-center justify-between"
            >
              <span>Send Now (Immediate)</span>
              <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                BullMQ Instant
              </span>
            </div>
            <div
              onClick={() => setSchedulePreset('tomorrow_9')}
              className="py-1.5 px-2 text-xs text-gray-600 hover:text-emerald-700 hover:bg-emerald-50/50 rounded-lg cursor-pointer transition-colors"
            >
              Tomorrow
            </div>
            <div
              onClick={() => setSchedulePreset('tomorrow_10')}
              className="py-1.5 px-2 text-xs text-gray-600 hover:text-emerald-700 hover:bg-emerald-50/50 rounded-lg cursor-pointer transition-colors"
            >
              Tomorrow, 10:00 AM
            </div>
            <div
              onClick={() => setSchedulePreset('tomorrow_11')}
              className="py-1.5 px-2 text-xs text-gray-600 hover:text-emerald-700 hover:bg-emerald-50/50 rounded-lg cursor-pointer transition-colors"
            >
              Tomorrow, 11:00 AM
            </div>
            <div
              onClick={() => setSchedulePreset('tomorrow_15')}
              className="py-1.5 px-2 text-xs text-gray-600 hover:text-emerald-700 hover:bg-emerald-50/50 rounded-lg cursor-pointer transition-colors"
            >
              Tomorrow, 3:00 PM
            </div>
          </div>

          {/* Bottom Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setShowSendLater(false)}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmSchedule}
              className="px-4 py-1 rounded-full border border-[#00a63e] hover:bg-emerald-50/40 text-[#00a63e] font-medium text-xs transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main Form Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-10 py-6">
        {/* Feedback Alerts */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-xl flex items-center space-x-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 rounded-xl flex items-center space-x-2 animate-in fade-in">
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-3">
          {/* Row 1: From Field */}
          <div className="flex items-center py-2 border-b border-gray-100 relative">
            <label className="w-20 sm:w-24 text-sm font-normal text-gray-500 flex-shrink-0">From</label>

            {/* Selected Sender Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowSenderDropdown(!showSenderDropdown);
                  setShowSendLater(false);
                }}
                disabled={sendersLoading}
                className="bg-[#f4f5f7] hover:bg-gray-200/70 rounded-lg px-3 py-1.5 flex items-center space-x-2 text-xs font-medium text-gray-800 transition-colors disabled:opacity-60"
              >
                <span>{sendersLoading ? 'Loading senders...' : selectedSenderEmail}</span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>

              {/* Sender Select Dropdown */}
              {showSenderDropdown && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-lg py-1.5 z-30 min-w-[240px] animate-in fade-in zoom-in-95">
                  <div className="px-3 py-1 text-[11px] font-medium text-gray-400 border-b border-gray-50">
                    Select Sender Account
                  </div>
                  {senders.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSelectedSenderId(s.id);
                        setShowSenderDropdown(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs font-medium flex items-center justify-between hover:bg-gray-50 transition-colors ${
                        s.id === selectedSenderId
                          ? 'text-emerald-700 bg-emerald-50/50 font-semibold'
                          : 'text-gray-700'
                      }`}
                    >
                      <span>{s.email}</span>
                      {s.id === selectedSenderId && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                      )}
                    </button>
                  ))}
                  {senders.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">
                      Default ReachInbox Sender Account
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Multi-Recipient To Field with Green Outlined Chips & Upload List matching reference */}
          <div className="flex items-center justify-between py-2 border-b border-gray-100 min-h-[42px] relative">
            <div
              className="flex items-center flex-wrap gap-2 flex-1 mr-4 min-w-0 cursor-text"
              onClick={() => recipientInputRef.current?.focus()}
            >
              <label className="w-20 sm:w-24 text-sm font-normal text-gray-500 flex-shrink-0 select-none">
                To
              </label>

              {/* Displayed Recipient Chips */}
              {visibleRecipients.map((email, idx) => (
                <div
                  key={idx}
                  className="inline-flex items-center space-x-1.5 border border-[#00a63e] rounded-full px-3 py-0.5 text-xs text-gray-800 bg-white hover:bg-emerald-50/50 transition-colors select-none group"
                >
                  <span className="truncate max-w-[180px]">{email}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecipient(idx);
                    }}
                    className="text-gray-400 hover:text-red-500 rounded-full transition-colors ml-0.5 p-0.5"
                    title={`Remove ${email}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {/* Collapsed +N Chip matching screenshot */}
              {!isExpanded && hasHiddenRecipients && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRemainingPopover(!showRemainingPopover);
                    }}
                    className="border border-[#00a63e] text-[#00a63e] hover:bg-emerald-50/60 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer transition-colors"
                    title="Click to view remaining recipients"
                  >
                    +{recipients.length - maxVisibleChips}
                  </button>

                  {/* Popover Dropdown for +N recipients */}
                  {showRemainingPopover && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 p-3 z-30 animate-in fade-in zoom-in-95"
                    >
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-100">
                        <span className="text-xs font-semibold text-gray-700">
                          Additional Recipients ({recipients.length - maxVisibleChips})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsExpanded(true);
                            setShowRemainingPopover(false);
                          }}
                          className="text-[11px] text-[#00a63e] hover:underline font-medium"
                        >
                          Expand All
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                        {recipients.slice(maxVisibleChips).map((email, i) => {
                          const realIdx = maxVisibleChips + i;
                          return (
                            <div
                              key={realIdx}
                              className="flex items-center justify-between bg-gray-50 hover:bg-gray-100/80 rounded-lg px-2.5 py-1 text-xs text-gray-700"
                            >
                              <span className="truncate mr-2">{email}</span>
                              <button
                                type="button"
                                onClick={() => removeRecipient(realIdx)}
                                className="text-gray-400 hover:text-red-500 transition-colors p-0.5"
                                title={`Remove ${email}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Collapse button when expanded */}
              {isExpanded && recipients.length > maxVisibleChips && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(false);
                  }}
                  className="border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer transition-colors"
                  title="Collapse recipients"
                >
                  Collapse
                </button>
              )}

              {/* Inline input for typing more email addresses */}
              <input
                type="text"
                ref={recipientInputRef}
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={handleRecipientKeyDown}
                onBlur={handleRecipientBlur}
                onPaste={handleRecipientPaste}
                placeholder={recipients.length === 0 ? 'recipient@example.com' : ''}
                className="flex-1 min-w-[120px] bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none border-0 p-0"
              />
            </div>

            {/* Upload List Action on the right side of To row matching screenshot */}
            <div className="flex items-center space-x-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => csvInputRef.current?.click()}
                className="inline-flex items-center space-x-1.5 text-sm font-medium text-[#00a63e] hover:text-emerald-700 transition-colors cursor-pointer"
                title="Upload CSV or TXT recipient list"
              >
                <Upload className="w-4 h-4 stroke-[2]" />
                <span>Upload List</span>
              </button>
            </div>
          </div>

          {/* Row 3: Subject Field */}
          <div className="flex items-center py-2 border-b border-gray-100">
            <label className="w-20 sm:w-24 text-sm font-normal text-gray-500 flex-shrink-0">Subject</label>
            <input
              type="text"
              required
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none border-0 p-0"
            />
          </div>

          {/* Row 4: Scheduling & Rate Limit Controls matching Figma */}
          <div className="flex flex-wrap items-center gap-6 py-2.5 border-b border-gray-100 text-sm">
            {/* Delay between 2 emails */}
            <div className="flex items-center space-x-3">
              <span className="text-sm font-normal text-gray-700">Delay between 2 emails</span>
              <input
                type="text"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="00"
                className="w-14 h-8 text-center bg-white border border-gray-200 rounded-lg text-xs font-mono text-gray-800 focus:outline-none focus:border-emerald-500 transition-colors"
                title="Delay in seconds between consecutive dispatches"
              />
            </div>

            {/* Hourly Limit */}
            <div className="flex items-center space-x-3">
              <span className="text-sm font-normal text-gray-700">Hourly Limit</span>
              <input
                type="text"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="00"
                className="w-14 h-8 text-center bg-white border border-gray-200 rounded-lg text-xs font-mono text-gray-800 focus:outline-none focus:border-emerald-500 transition-colors"
                title="Maximum number of emails allowed per hour"
              />
            </div>
          </div>

          {/* Large Composition Box with Embedded Pill Toolbar matching reference screenshot */}
          <div
            onClick={() => document.getElementById('compose-body-textarea')?.focus()}
            className="bg-[#fafbfc] rounded-2xl border border-gray-100 p-6 mt-4 min-h-[420px] flex flex-col focus-within:border-gray-200 transition-colors cursor-text"
          >
            {/* Top Prompt matching screenshot: "Type Your Reply..." */}
            {!body && (
              <div className="text-sm text-gray-400 font-normal pb-3 select-none pointer-events-none">
                Type Your Reply...
              </div>
            )}

            {/* Floating White Pill Toolbar matching screenshot */}
            <div className="flex items-center mb-3">
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-full px-5 py-2 shadow-sm border border-gray-100 flex items-center space-x-3 text-gray-400 select-none flex-wrap gap-y-2"
              >
                <button
                  type="button"
                  onClick={() => document.execCommand('undo')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Undo"
                >
                  <Undo className="w-4 h-4 stroke-[1.8]" />
                </button>

                <button
                  type="button"
                  onClick={() => document.execCommand('redo')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Redo"
                >
                  <Redo className="w-4 h-4 stroke-[1.8]" />
                </button>

                <div className="h-4 w-px bg-gray-200 mx-1" />

                {/* Font / Typography selector */}
                <button
                  type="button"
                  onClick={() => applyFormat('<p>', '</p>')}
                  className="flex items-center space-x-0.5 text-xs font-semibold text-gray-600 hover:text-gray-900 p-1"
                  title="Paragraph / Text Options"
                >
                  <span>Tt</span>
                  <ChevronsUpDown className="w-3 h-3 text-gray-400" />
                </button>

                <div className="h-4 w-px bg-gray-200 mx-1" />

                {/* Bold */}
                <button
                  type="button"
                  onClick={() => applyFormat('**', '**')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Bold"
                >
                  <Bold className="w-4 h-4 stroke-[1.8]" />
                </button>

                {/* Italic */}
                <button
                  type="button"
                  onClick={() => applyFormat('*', '*')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Italic"
                >
                  <Italic className="w-4 h-4 stroke-[1.8]" />
                </button>

                {/* Underline */}
                <button
                  type="button"
                  onClick={() => applyFormat('<u>', '</u>')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Underline"
                >
                  <Underline className="w-4 h-4 stroke-[1.8]" />
                </button>

                <div className="h-4 w-px bg-gray-200 mx-1" />

                {/* Alignment */}
                <button
                  type="button"
                  onClick={() => applyFormat('')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Align"
                >
                  <AlignLeft className="w-4 h-4 stroke-[1.8]" />
                </button>

                {/* Line height */}
                <button
                  type="button"
                  onClick={() => applyFormat('\n\n')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Line spacing"
                >
                  <ChevronsUpDown className="w-4 h-4 stroke-[1.8]" />
                </button>

                <div className="h-4 w-px bg-gray-200 mx-1" />

                {/* Ordered list */}
                <button
                  type="button"
                  onClick={() => applyFormat('\n1. ')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Numbered List"
                >
                  <ListOrdered className="w-4 h-4 stroke-[1.8]" />
                </button>

                {/* Unordered list */}
                <button
                  type="button"
                  onClick={() => applyFormat('\n- ')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Bullet List"
                >
                  <List className="w-4 h-4 stroke-[1.8]" />
                </button>

                {/* Indent / Outdent */}
                <button
                  type="button"
                  onClick={() => applyFormat('  ')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Indent"
                >
                  <Indent className="w-4 h-4 stroke-[1.8]" />
                </button>

                <button
                  type="button"
                  onClick={() => applyFormat('')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Outdent"
                >
                  <Outdent className="w-4 h-4 stroke-[1.8]" />
                </button>

                {/* Quote */}
                <button
                  type="button"
                  onClick={() => applyFormat('\n> ')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Quote"
                >
                  <Quote className="w-4 h-4 stroke-[1.8]" />
                </button>

                {/* Link */}
                <button
                  type="button"
                  onClick={() => applyFormat('[', '](https://example.com)')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Insert Link"
                >
                  <LinkIcon className="w-4 h-4 stroke-[1.8]" />
                </button>

                <div className="h-4 w-px bg-gray-200 mx-1" />

                {/* Strikethrough */}
                <button
                  type="button"
                  onClick={() => applyFormat('~~', '~~')}
                  className="hover:text-gray-800 transition-colors p-1"
                  title="Strikethrough"
                >
                  <Strikethrough className="w-4 h-4 stroke-[1.8]" />
                </button>
              </div>
            </div>

            {/* Composition Area Textarea */}
            <textarea
              id="compose-body-textarea"
              rows={12}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full flex-1 bg-transparent text-sm text-gray-800 focus:outline-none resize-none pt-2 min-h-[280px] leading-relaxed font-sans border-0 p-0"
            />
          </div>

          {/* Attachments Section below editor matching screenshot */}
          {attachments.length > 0 && (
            <div className="mt-4 pt-1">
              <div className="flex flex-wrap gap-4 items-start">
                {attachments.map((att, index) => (
                  <div
                    key={index}
                    className="group relative bg-white border border-gray-200 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-3 max-w-xs sm:max-w-sm"
                  >
                    {/* Image Thumbnail Preview if image */}
                    {att.previewUrl ? (
                      <div className="w-24 h-20 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-100">
                        <img
                          src={att.previewUrl}
                          alt={att.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0 text-gray-500">
                        <FileText className="w-7 h-7 text-gray-400" />
                      </div>
                    )}

                    {/* Filename & Metadata */}
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="text-xs font-semibold text-gray-800 truncate" title={att.name}>
                        {att.name}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5 font-mono">
                        {att.size}
                      </p>
                      <span className="inline-block text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 mt-1">
                        Attached
                      </span>
                    </div>

                    {/* Remove Button */}
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100 transition-colors self-start sm:self-center"
                      title="Remove attachment"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                * Attachments will be stored and dispatched with your email.
              </p>
            </div>
          )}
        </form>
      </main>
    </div>
  );
};
