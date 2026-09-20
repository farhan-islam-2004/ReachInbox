import React, { useState } from 'react';
import { Email, EmailAttachment } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft,
  Star,
  Archive,
  Trash2,
  ChevronDown,
  Copy,
  Check,
  FileText,
} from 'lucide-react';

interface EmailDetailModalProps {
  email: Email | null;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onToggleStar?: (id: string) => void;
}

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({
  email,
  onClose,
  onDelete,
  onToggleStar,
}) => {
  const { user } = useAuth();
  const [isStarred, setIsStarred] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [showArchiveToast, setShowArchiveToast] = useState(false);

  // Resolve attachments safely from explicit property, JSON string, or embedded comments
  const attachments: EmailAttachment[] = React.useMemo(() => {
    if (!email) return [];
    if (Array.isArray(email.attachments) && email.attachments.length > 0) {
      return (email.attachments as EmailAttachment[]).filter(Boolean);
    }
    if (typeof email.attachments === 'string') {
      try {
        const parsed = JSON.parse(email.attachments);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {
        // ignore
      }
    }
    try {
      const match = (email.body ?? '').match(/<!--\s*attachments:\s*(\[.*?\])\s*-->/s);
      if (match && match[1]) {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      }
    } catch {
      // ignore
    }
    return [];
  }, [email]);

  // Clean body without internal metadata comments
  const cleanBody = React.useMemo(() => {
    if (!email) return '';
    return (email.body ?? '').replace(/<!--\s*attachments:.*?-->/s, '').trim();
  }, [email?.body]);

  // Early return ONLY AFTER all hooks have executed unconditionally
  if (!email) return null;

  const handleCopyMessageId = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (email.messageId) {
      navigator.clipboard.writeText(email.messageId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const handleStarToggle = () => {
    setIsStarred((prev) => !prev);
    if (onToggleStar) onToggleStar(email.id);
  };

  const handleArchive = () => {
    setShowArchiveToast(true);
    setTimeout(() => {
      setShowArchiveToast(false);
      onClose();
    }, 800);
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(email.id);
    }
    onClose();
  };

  // Helper to resolve sender display name cleanly
  const getSenderName = () => {
    if (email.sender?.email) {
      const username = email.sender.email.split('@')[0];
      return username
        .split(/[._-]+/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ');
    }
    return user?.name || 'Sender';
  };

  // Helper to resolve sender email
  const getSenderEmail = () => {
    return email.sender?.email || user?.email || '';
  };

  // Format date cleanly like "Nov 3, 10:23 AM" matching reference screenshot
  const formatDetailDate = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const month = d.toLocaleDateString('en-US', { month: 'short' });
      const day = d.getDate();
      const time = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `${month} ${day}, ${time}`;
    } catch {
      return dateStr;
    }
  };

  const senderName = getSenderName();
  const senderEmail = getSenderEmail();
  const senderInitial = senderName.charAt(0).toUpperCase() || 'A';
  const displayDate = formatDetailDate(email.sentAt || email.scheduledAt || email.createdAt);

  // Helper to parse inline bold, italic, and URLs
  const formatInlineStyles = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*.*?\*\*|\*.*?\*|https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(
          <strong key={match.index} className="font-bold text-gray-900">
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(
          <em key={match.index} className="italic text-gray-700">
            {token.slice(1, -1)}
          </em>
        );
      } else if (token.startsWith('http')) {
        parts.push(
          <a
            key={match.index}
            href={token}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-600 hover:underline"
          >
            {token}
          </a>
        );
      }
      lastIndex = match.index + token.length;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  // Render email body preserving paragraphs, line breaks, bold, italic, callouts, and HTML
  const renderFormattedBody = (body: string) => {
    if (!body) return null;

    // Detect if body contains HTML tags
    const hasHtml = /<[a-z][\s\S]*>/i.test(body);
    if (hasHtml) {
      return (
        <div
          className="prose max-w-none text-gray-800 text-sm leading-relaxed space-y-4
            [&_blockquote]:bg-[#fffde7] [&_blockquote]:border-l-4 [&_blockquote]:border-[#facc15] [&_blockquote]:p-4 [&_blockquote]:rounded-r-xl [&_blockquote]:my-4 [&_blockquote]:font-medium [&_blockquote]:text-gray-900 [&_blockquote]:not-italic
            [&_.callout]:bg-[#fffde7] [&_.callout]:border-l-4 [&_.callout]:border-[#facc15] [&_.callout]:p-4 [&_.callout]:rounded-r-xl [&_.callout]:my-4 [&_.callout]:font-medium [&_.callout]:text-gray-900
            [&_a]:text-emerald-600 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: body }}
        />
      );
    }

    // Plain text / Markdown-like body
    const paragraphs = body.split(/\n\s*\n/);

    return (
      <div className="space-y-4 text-sm text-gray-800 leading-relaxed font-sans">
        {paragraphs.map((para, pIdx) => {
          const trimmed = para.trim();
          if (!trimmed) return null;

          // Check if paragraph is a highlight / callout block
          const isCallout =
            trimmed.startsWith('⚡') ||
            trimmed.startsWith('>') ||
            trimmed.includes('Extremely Exclusive') ||
            trimmed.startsWith('Important:');

          if (isCallout) {
            const cleanText = trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed;
            return (
              <div
                key={pIdx}
                className="bg-[#fffde7] border-l-4 border-[#facc15] p-4 rounded-r-xl my-4 text-gray-900 font-medium text-sm leading-relaxed shadow-sm space-y-1.5"
              >
                {cleanText.split('\n').map((line, lIdx) => (
                  <div key={lIdx}>{formatInlineStyles(line)}</div>
                ))}
              </div>
            );
          }

          // Regular paragraph with line breaks
          const lines = trimmed.split('\n');
          return (
            <p key={pIdx} className="leading-relaxed">
              {lines.map((line, lIdx) => (
                <React.Fragment key={lIdx}>
                  {formatInlineStyles(line)}
                  {lIdx < lines.length - 1 && <br />}
                </React.Fragment>
              ))}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto flex flex-col font-sans animate-in fade-in duration-150">
      {/* Toast notification for Archive action */}
      {showArchiveToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-4 py-2 rounded-full shadow-lg z-50 flex items-center space-x-2">
          <Archive className="w-3.5 h-3.5 text-emerald-400" />
          <span>Email moved to archive</span>
        </div>
      )}

      {/* Top Header matching reference screenshot */}
      <header className="px-6 sm:px-8 py-3.5 flex items-center justify-between border-b border-gray-100 bg-white sticky top-0 z-20">
        <div className="flex items-center space-x-3 min-w-0 flex-1 mr-4">
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-700 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors -ml-2 flex-shrink-0"
            title="Back to email list"
          >
            <ArrowLeft className="w-5 h-5 stroke-[1.8]" />
          </button>
          <h1 className="text-base sm:text-lg font-normal text-gray-900 truncate">
            {email.subject}
          </h1>
        </div>

        {/* Header Actions matching reference screenshot */}
        <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleStarToggle}
            className="p-2 text-gray-400 hover:text-amber-500 rounded-full hover:bg-gray-50 transition-colors"
            title={isStarred ? 'Starred' : 'Star this email'}
          >
            <Star
              className={`w-5 h-5 stroke-[1.8] ${
                isStarred ? 'fill-amber-400 text-amber-400' : ''
              }`}
            />
          </button>

          <button
            type="button"
            onClick={handleArchive}
            className="p-2 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-50 transition-colors"
            title="Archive"
          >
            <Archive className="w-5 h-5 stroke-[1.8]" />
          </button>

          <button
            type="button"
            onClick={handleDelete}
            className="p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-50 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-5 h-5 stroke-[1.8]" />
          </button>

          <div className="h-5 w-px bg-gray-200 mx-1 sm:mx-2" />

          <img
            src={user?.avatar || '/oliver-avatar.png'}
            alt={user?.name || 'User avatar'}
            className="w-7 h-7 rounded-full object-cover ml-1 bg-gray-200 border border-gray-100"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/oliver-avatar.png';
            }}
          />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-12 py-8">
        {/* Sender Section matching reference screenshot */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
          <div className="flex items-start space-x-3.5 min-w-0">
            {/* Green Circular Sender Avatar */}
            <div className="w-10 h-10 rounded-full bg-[#34a853] text-white flex items-center justify-center font-semibold text-base flex-shrink-0 shadow-sm select-none">
              {senderInitial}
            </div>

            <div className="min-w-0 relative">
              {/* Sender Name & Email */}
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-bold text-sm text-gray-900">{senderName}</span>
                <span className="text-xs text-gray-400 font-normal truncate">
                  &lt;{senderEmail}&gt;
                </span>
              </div>

              {/* 'to me' with dropdown toggle */}
              <div className="relative mt-0.5">
                <button
                  type="button"
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="text-xs text-gray-500 hover:text-gray-800 flex items-center space-x-1 transition-colors focus:outline-none"
                >
                  <span>to me</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
                      showDropdown ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Dropdown Card for technical email details & delivery trace */}
                {showDropdown && (
                  <div className="absolute left-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-30 w-80 text-xs space-y-2 animate-in fade-in zoom-in-95">
                    <div className="flex justify-between border-b border-gray-100 pb-2">
                      <span className="text-gray-400 font-medium">From:</span>
                      <span className="font-medium text-gray-800 text-right truncate ml-2">
                        {senderName} &lt;{senderEmail}&gt;
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-gray-100 pb-2">
                      <span className="text-gray-400 font-medium">To:</span>
                      <span className="font-medium text-gray-800 text-right truncate ml-2">
                        {email.recipient}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-gray-100 pb-2">
                      <span className="text-gray-400 font-medium">Date:</span>
                      <span className="text-gray-700 text-right">
                        {new Date(email.scheduledAt || email.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-gray-100 pb-2">
                      <span className="text-gray-400 font-medium">Status:</span>
                      <span className="font-semibold text-emerald-600 uppercase tracking-wide">
                        {email.status}
                      </span>
                    </div>
                    {email.messageId && (
                      <div className="pt-1">
                        <div className="flex items-center justify-between text-gray-400 font-medium mb-1">
                          <span>SMTP Message-ID:</span>
                          <button
                            type="button"
                            onClick={handleCopyMessageId}
                            className="text-emerald-600 hover:text-emerald-700 flex items-center space-x-0.5"
                          >
                            {copiedId ? (
                              <>
                                <Check className="w-3 h-3" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                        <p className="font-mono text-[10px] text-gray-600 break-all bg-gray-50 p-1.5 rounded">
                          {email.messageId}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Date / Time aligned to the right */}
          <div className="text-xs text-gray-400 font-normal whitespace-nowrap self-start pt-1">
            {displayDate}
          </div>
        </div>

        {/* Email Body */}
        <div className="pl-0 sm:pl-[54px] pt-2 max-w-4xl">
          {renderFormattedBody(cleanBody)}

          {/* Attachments Section — Rendered ONLY if email has attachments */}
          {attachments.length > 0 && (
            <div className="mt-8 pt-4">
              <div className="flex flex-wrap gap-4">
                {attachments.map((att, idx) => {
                  if (!att) return null;
                  const filename = att.filename || 'Attachment';
                  const isImage =
                    att.contentType?.startsWith('image/') ||
                    /\.(png|jpe?g|webp|gif)$/i.test(filename) ||
                    att.previewUrl ||
                    att.url;
                  return (
                    <div
                      key={idx}
                      className="w-48 sm:w-52 border border-gray-200/90 rounded-2xl overflow-hidden shadow-sm hover:shadow transition-shadow bg-white flex flex-col group cursor-pointer"
                    >
                      <div className="h-28 sm:h-32 bg-gray-100 overflow-hidden relative flex items-center justify-center">
                        {isImage ? (
                          <img
                            src={att.previewUrl || att.url || '/tennis-preview.png'}
                            alt={filename}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <FileText className="w-10 h-10 text-gray-400" />
                        )}
                      </div>
                      <div className="p-3 bg-[#fbfcfd] border-t border-gray-100">
                        <p
                          className="text-xs font-semibold text-gray-800 truncate"
                          title={filename}
                        >
                          {filename}
                        </p>
                        {att.size && (
                          <p className="text-[11px] text-gray-400 mt-0.5">{att.size}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
