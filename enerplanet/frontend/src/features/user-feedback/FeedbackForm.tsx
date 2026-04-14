import React, { useState, useRef, useCallback, useEffect } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Send,
  MessageSquare,
  Bug,
  Lightbulb,
  Star,
  MessageCircle,
  CheckCircle,
  X,
  AlertTriangle,
  ImagePlus,
  Trash2,
  Eye,
  Pencil,
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Link,
  Heading,
  Quote,
  Strikethrough,
  Minus,
  Table,
  ListChecks,
  SquareCode,
  Clock,
  ChevronDown,
  ChevronUp,
  Shield,
  Loader2,
} from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import axios from "@/lib/axios";
import { useTranslation } from "@spatialhub/i18n";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Types
interface FeedbackFormData {
  category: string;
  subject: string;
  message: string;
  rating: number;
  images: File[];
}

interface SnackbarState {
  open: boolean;
  message: string;
  severity: "success" | "error" | "warning" | "info";
}

type CategoryKey = "bug" | "feature" | "improvement" | "general";

// Category icons only - labels come from translations
const CATEGORY_ICONS: Record<CategoryKey, React.ReactNode> = {
  bug: <Bug className="w-5 h-5" />,
  feature: <Lightbulb className="w-5 h-5" />,
  improvement: <Star className="w-5 h-5" />,
  general: <MessageCircle className="w-5 h-5" />
};

/**
 * Compress an image file using Canvas.
 * Resizes large images and converts to JPEG to keep uploads small.
 */
const compressImage = (file: File, maxWidth = 1920, maxHeight = 1080, quality = 0.8): Promise<File> =>
  new Promise((resolve, reject) => {
    // Skip non-raster formats (SVG, etc.)
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      resolve(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down if larger than max dimensions
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          // Keep the original name but change extension to .jpg
          const name = file.name.replace(/\.[^.]+$/, '.jpg');
          resolve(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
        },
        'image/jpeg',
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = url;
  });

const ALERT_STYLES = {
  success: "bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-800 dark:text-green-200",
  error: "bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200",
  warning: "bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200",
  info: "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200"
};

const ALERT_ICONS = {
  success: <CheckCircle className="w-5 h-5" />,
  error: <AlertTriangle className="w-5 h-5" />,
  warning: <AlertTriangle className="w-5 h-5" />,
  info: <MessageCircle className="w-5 h-5" />
};

// Components
const Rating: React.FC<{
  value: number;
  onChange: (value: number) => void;
}> = ({ value, onChange }) => {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          className="transition-colors w-6 h-6"
        >
          <Star
            className={`w-6 h-6 transition-colors ${
              star <= (hover || value) 
                ? "text-gray-700 dark:text-yellow-400 fill-gray-700 dark:fill-yellow-400" 
                : "text-gray-300 dark:text-gray-600"
            }`}
          />
        </button>
      ))}
    </div>
  );
};

const Alert: React.FC<{
  severity: keyof typeof ALERT_STYLES;
  children: React.ReactNode;
  onClose?: () => void;
}> = ({ severity, children, onClose }) => (
  <div className={`p-4 rounded-lg border flex items-center gap-3 ${ALERT_STYLES[severity]}`}>
    {ALERT_ICONS[severity]}
    <div className="flex-1">{children}</div>
    {onClose && (
      <button onClick={onClose} className="text-current hover:opacity-70">
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
);

const Snackbar: React.FC<SnackbarState & { onClose: () => void }> = ({ 
  open, 
  message, 
  severity, 
  onClose 
}) => {
  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
      <Alert severity={severity} onClose={onClose}>
        {message}
      </Alert>
    </div>
  );
};

const SuccessScreen: React.FC<{ t: (key: string) => string }> = ({ t }) => (
  <div className="max-w-2xl mx-auto p-6 animate-fade-in">
    <div className="bg-card text-card-foreground rounded-xl p-8 shadow-sm border border-border text-center">
      <div className="w-14 h-14 bg-primary rounded-full flex items-center justify-center mx-auto mb-5">
        <CheckCircle className="w-7 h-7 text-primary-foreground" />
      </div>
      <h2 className="text-xl font-bold text-foreground mb-3">{t("feedback.success.title")}</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        {t("feedback.success.message")}
      </p>
      <p className="text-xs text-muted-foreground bg-muted rounded-lg py-2 px-4 inline-block">
        {t("feedback.success.reference")}: FB-{Date.now().toString().slice(-6)}
      </p>
    </div>
  </div>
);

const FormSection: React.FC<{
  title: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ title, required, children }) => (
  <div className="bg-card text-card-foreground rounded-xl p-5 shadow-sm border border-border">
    {title && (
      <h3 className="text-sm font-semibold text-foreground mb-4">
        {title} {required && <span className="text-red-500">*</span>}
      </h3>
    )}
    {children}
  </div>
);

// Types for user feedback history
interface MyFeedbackItem {
  id: number;
  category: string;
  subject: string;
  status: "pending" | "in_progress" | "resolved" | "closed";
  priority: string;
  admin_response: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG: Record<string, { color: string; bgColor: string; icon: React.ReactNode }> = {
  pending: { color: "text-amber-600 dark:text-amber-400", bgColor: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800", icon: <Clock className="w-3.5 h-3.5" /> },
  in_progress: { color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  resolved: { color: "text-green-600 dark:text-green-400", bgColor: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800", icon: <CheckCircle className="w-3.5 h-3.5" /> },
  closed: { color: "text-gray-500 dark:text-gray-400", bgColor: "bg-gray-50 dark:bg-gray-950/30 border-gray-200 dark:border-gray-700", icon: <X className="w-3.5 h-3.5" /> },
};

const getDaysUntilDeletion = (updatedAt: string, status: string): number | null => {
  if (status !== "closed" && status !== "resolved") return null;
  const updated = new Date(updatedAt);
  const deleteAt = new Date(updated.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  return Math.max(0, Math.ceil((deleteAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
};

const MyFeedbackHistory: React.FC<{ userId: string; refreshTrigger: number }> = ({ userId, refreshTrigger }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<MyFeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    axios.get(`/feedback/my?per_page=20`)
      .then(res => {
        setItems(res.data?.data?.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, refreshTrigger]);

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-3">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {expanded ? t("feedback.myFeedback.hideHistory") : t("feedback.myFeedback.showHistory")} ({items.length})
      </button>

      {expanded && (
        <div className="space-y-2">
          {items.map(item => {
            const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
            const statusKey = item.status === "in_progress" ? "in_progress" : item.status;
            const daysLeft = getDaysUntilDeletion(item.updated_at, item.status);

            return (
              <div key={item.id} className={`rounded-lg border p-3 ${statusCfg.bgColor}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${statusCfg.color} ${statusCfg.bgColor}`}>
                        {statusCfg.icon}
                        {t(`feedback.myFeedback.status.${statusKey}`)}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">{item.category}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground truncate">{item.subject}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("feedback.myFeedback.submittedOn")} {new Date(item.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>

                {item.admin_response && (
                  <div className="mt-2 pt-2 border-t border-border/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Shield className="w-3 h-3 text-primary" />
                      <span className="text-xs font-medium text-primary">{t("feedback.myFeedback.adminResponse")}</span>
                    </div>
                    <p className="text-xs text-foreground/80 leading-relaxed">{item.admin_response}</p>
                  </div>
                )}

                {daysLeft !== null && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 italic">
                    {daysLeft > 0
                      ? t("feedback.myFeedback.autoDeleteNotice").replace("{days}", String(daysLeft))
                      : t("feedback.myFeedback.autoDeleteSoon")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Main Component
export const FeedbackComponent: React.FC = () => {
  const { t } = useTranslation();
  useDocumentTitle(t('feedback.title'));
  
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [feedbackData, setFeedbackData] = useState<FeedbackFormData>({
    category: "",
    subject: "",
    message: "",
    rating: 0,
    images: [],
  });
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [messageTab, setMessageTab] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: "",
    severity: "success",
  });

  const updateField = <K extends keyof FeedbackFormData>(
    field: K,
    value: FeedbackFormData[K]
  ) => {
    setFeedbackData(prev => ({ ...prev, [field]: value }));
  };

  const insertMarkdown = useCallback((prefix: string, suffix: string = "", placeholder: string = "") => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = feedbackData.message;
    const selected = text.substring(start, end);
    const insert = selected || placeholder;
    const newText = text.substring(0, start) + prefix + insert + suffix + text.substring(end);
    updateField("message", newText);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursorPos = start + prefix.length + insert.length;
      textarea.setSelectionRange(
        selected ? cursorPos + suffix.length : start + prefix.length,
        selected ? cursorPos + suffix.length : start + prefix.length + insert.length
      );
    });
  }, [feedbackData.message]);

  // Insert block-level markdown (ensures newline before/after)
  const insertBlock = useCallback((block: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const text = feedbackData.message;
    const before = text.substring(0, start);
    const after = text.substring(start);
    const needsNewlineBefore = before.length > 0 && !before.endsWith("\n\n");
    const needsNewlineAfter = after.length > 0 && !after.startsWith("\n");
    const prefix = needsNewlineBefore ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const suffix = needsNewlineAfter ? "\n" : "";
    const newText = before + prefix + block + suffix + after;
    updateField("message", newText);
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = before.length + prefix.length + block.length;
      textarea.setSelectionRange(pos, pos);
    });
  }, [feedbackData.message]);

  // Keyboard shortcuts handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Auto-continue lists on Enter
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const textarea = e.currentTarget;
      const { selectionStart } = textarea;
      const text = feedbackData.message;
      const beforeCursor = text.substring(0, selectionStart);
      const currentLineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentLine = beforeCursor.substring(currentLineStart);

      // Match list patterns: "- ", "* ", "1. ", "- [ ] ", "- [x] ", "> "
      const listMatch = currentLine.match(/^(\s*)([-*]\s\[[ x]\]\s|[-*]\s|\d+\.\s|>\s)/);
      if (listMatch) {
        const [, indent, prefix] = listMatch;
        const contentAfterPrefix = currentLine.substring(indent.length + prefix.length);

        // If the line is empty (just the prefix), remove the prefix instead of continuing
        if (!contentAfterPrefix.trim()) {
          e.preventDefault();
          const newText = text.substring(0, currentLineStart) + "\n" + text.substring(selectionStart);
          updateField("message", newText);
          requestAnimationFrame(() => {
            textarea.focus();
            const pos = currentLineStart + 1;
            textarea.setSelectionRange(pos, pos);
          });
          return;
        }

        e.preventDefault();
        // For ordered lists, increment the number
        let nextPrefix = prefix;
        const numMatch = prefix.match(/^(\d+)\.\s$/);
        if (numMatch) {
          nextPrefix = `${parseInt(numMatch[1]) + 1}. `;
        }
        // For task lists, always start unchecked
        if (prefix.match(/[-*]\s\[x\]\s/)) {
          nextPrefix = prefix.replace("[x]", "[ ]");
        }
        const insertion = "\n" + indent + nextPrefix;
        const newText = text.substring(0, selectionStart) + insertion + text.substring(selectionStart);
        updateField("message", newText);
        requestAnimationFrame(() => {
          textarea.focus();
          const pos = selectionStart + insertion.length;
          textarea.setSelectionRange(pos, pos);
        });
        return;
      }
    }

    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const shortcuts: Record<string, () => void> = {
      b: () => insertMarkdown("**", "**", "bold"),
      i: () => insertMarkdown("_", "_", "italic"),
      k: () => insertMarkdown("[", "](url)", "link text"),
      e: () => insertMarkdown("`", "`", "code"),
      d: () => insertMarkdown("~~", "~~", "strikethrough"),
    };
    if (e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setMessageTab("preview");
      return;
    }
    const handler = shortcuts[e.key.toLowerCase()];
    if (handler) {
      e.preventDefault();
      handler();
    }
  }, [insertMarkdown]);

  const handleImageSelect = async (files: File[]) => {
    const validFiles: File[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        setSnackbar({
          open: true,
          message: t("feedback.errors.invalidImageType"),
          severity: "error",
        });
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    // Compress images before storing
    const compressed: File[] = [];
    for (const file of validFiles) {
      try {
        compressed.push(await compressImage(file));
      } catch {
        compressed.push(file); // fallback to original on error
      }
    }

    setFeedbackData(prev => ({ ...prev, images: [...prev.images, ...compressed] }));

    // Create previews from compressed files
    for (const file of compressed) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviews(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleImageSelect(Array.from(files));
    }
    // Reset input so same files can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleImageSelect(Array.from(files));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const removeImage = (index: number) => {
    setFeedbackData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      setSnackbar({
        open: true,
        message: t("feedback.errors.loginRequired"),
        severity: "error",
      });
      return;
    }

    setLoading(true);

    try {
      // Use FormData to support file upload
      const formData = new FormData();
      formData.append('category', feedbackData.category);
      formData.append('subject', feedbackData.subject);
      formData.append('message', feedbackData.message);
      formData.append('rating', feedbackData.rating.toString());
      for (const image of feedbackData.images) {
        formData.append('images', image);
      }

      const { data } = await axios.post("/feedback", formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (data.success) {
        setSubmitted(true);
        setHistoryRefresh(prev => prev + 1);
        setSnackbar({
          open: true,
          message: data.message || t("feedback.success.message"),
          severity: "success",
        });

        // Reset form after 3 seconds
        setTimeout(() => {
          setFeedbackData({
            category: "",
            subject: "",
            message: "",
            rating: 0,
            images: [],
          });
          setImagePreviews([]);
          setSubmitted(false);
        }, 3000);
      } else {
        throw new Error(data.message || t("feedback.errors.submitFailed"));
      }
    } catch (error: unknown) {
      if (import.meta.env.DEV) console.error("Error submitting feedback:", error);
      let message = t("feedback.errors.submitFailed");
      if (error && typeof error === 'object' && 'response' in error && (error as { response?: { status?: number } }).response?.status === 413) {
        message = t("feedback.errors.payloadTooLarge", "The attachment is too large. Please use smaller images.");
      } else if (error instanceof Error) {
        message = error.message;
      }
      setSnackbar({
        open: true,
        message,
        severity: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const isFormValid = feedbackData.category && feedbackData.subject && feedbackData.message;

  if (submitted) {
    return <SuccessScreen t={t} />;
  }

  // Category config with translated labels
  const getCategoryConfig = (key: CategoryKey) => ({
    icon: CATEGORY_ICONS[key],
    label: t(`feedback.categories.${key}`),
    description: t(`feedback.categories.${key}Description`)
  });

  return (
    <div className="max-w-3xl mx-auto p-6 bg-background text-foreground">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 dark:from-gray-900 dark:to-black rounded-xl p-6 mb-6 text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/10 backdrop-blur rounded-xl flex items-center justify-center">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("feedback.title")}</h1>
            <p className="text-gray-300 text-sm">{t("feedback.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* My Feedback History */}
      {user?.id && <MyFeedbackHistory userId={String(user.id)} refreshTrigger={historyRefresh} />}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Category Selection */}
        <FormSection title={t("feedback.category")} required>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(Object.keys(CATEGORY_ICONS) as CategoryKey[]).map((key) => {
                const config = getCategoryConfig(key);
                const isSelected = feedbackData.category === key;
                
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateField("category", key)}
                    className={`
                      p-4 rounded-xl border-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md text-left
                      ${isSelected 
                        ? 'border-primary bg-accent' 
                        : 'border-border hover:border-muted-foreground bg-card'
                      }
                    `}
                  >
                    <div className={`p-2 rounded-lg inline-flex mb-2 ${isSelected ? 'bg-primary' : 'bg-muted'}`}>
                      <span className={isSelected ? 'text-primary-foreground' : 'text-muted-foreground'}>
                        {config.icon}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {config.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {config.description}
                    </p>
                  </button>
                );
              }
            )}
          </div>
        </FormSection>

        {/* Subject */}
        <FormSection title={t("feedback.subject")} required>
          <input
            type="text"
            value={feedbackData.subject}
            onChange={(e) => updateField("subject", e.target.value)}
            placeholder={t("feedback.subjectPlaceholder")}
            required
            className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent transition-colors bg-background dark:bg-input text-foreground placeholder-muted-foreground"
          />
        </FormSection>

        {/* Message with Markdown Editor */}
        <FormSection title={t("feedback.message")} required>
          <div className="border border-border rounded-lg overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-2 py-1.5">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setMessageTab("write")}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
                    messageTab === "write"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Pencil className="w-3 h-3" />
                  {t("feedback.write", "Write")}
                </button>
                <button
                  type="button"
                  onClick={() => setMessageTab("preview")}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
                    messageTab === "preview"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  {t("feedback.preview", "Preview")}
                </button>
              </div>
              {messageTab === "write" && (
                <div className="flex items-center">
                  {/* Text formatting */}
                  <div className="flex items-center gap-0.5">
                    {[
                      { icon: <Heading className="w-3.5 h-3.5" />, action: () => insertMarkdown("### ", "", "heading"), title: "Heading (H3)" },
                      { icon: <Bold className="w-3.5 h-3.5" />, action: () => insertMarkdown("**", "**", "bold"), title: "Bold (Ctrl+B)" },
                      { icon: <Italic className="w-3.5 h-3.5" />, action: () => insertMarkdown("_", "_", "italic"), title: "Italic (Ctrl+I)" },
                      { icon: <Strikethrough className="w-3.5 h-3.5" />, action: () => insertMarkdown("~~", "~~", "strikethrough"), title: "Strikethrough (Ctrl+D)" },
                    ].map((btn, i) => (
                      <button key={i} type="button" onClick={btn.action} title={btn.title}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">
                        {btn.icon}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-4 bg-border mx-1" />
                  {/* Structure */}
                  <div className="flex items-center gap-0.5">
                    {[
                      { icon: <Quote className="w-3.5 h-3.5" />, action: () => insertBlock("> blockquote"), title: "Quote" },
                      { icon: <Code className="w-3.5 h-3.5" />, action: () => insertMarkdown("`", "`", "code"), title: "Inline Code (Ctrl+E)" },
                      { icon: <SquareCode className="w-3.5 h-3.5" />, action: () => insertBlock("```\ncode block\n```"), title: "Code Block" },
                      { icon: <Minus className="w-3.5 h-3.5" />, action: () => insertBlock("---"), title: "Horizontal Rule" },
                    ].map((btn, i) => (
                      <button key={i} type="button" onClick={btn.action} title={btn.title}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">
                        {btn.icon}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-4 bg-border mx-1" />
                  {/* Lists & links */}
                  <div className="flex items-center gap-0.5">
                    {[
                      { icon: <List className="w-3.5 h-3.5" />, action: () => insertBlock("- item"), title: "Bullet List" },
                      { icon: <ListOrdered className="w-3.5 h-3.5" />, action: () => insertBlock("1. item"), title: "Numbered List" },
                      { icon: <ListChecks className="w-3.5 h-3.5" />, action: () => insertBlock("- [ ] task"), title: "Task List" },
                      { icon: <Link className="w-3.5 h-3.5" />, action: () => insertMarkdown("[", "](url)", "link text"), title: "Link (Ctrl+K)" },
                      { icon: <Table className="w-3.5 h-3.5" />, action: () => insertBlock("| Column 1 | Column 2 |\n| --- | --- |\n| cell | cell |"), title: "Table" },
                    ].map((btn, i) => (
                      <button key={i} type="button" onClick={btn.action} title={btn.title}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors">
                        {btn.icon}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Write / Preview */}
            {messageTab === "write" ? (
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={feedbackData.message}
                  onChange={(e) => updateField("message", e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("feedback.messagePlaceholder")}
                  required
                  rows={10}
                  className="w-full px-4 py-3 bg-background dark:bg-input text-foreground placeholder-muted-foreground resize-y min-h-[200px] focus:outline-none text-sm font-mono leading-relaxed"
                />
                {/* Footer bar with word/char count */}
                <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">
                  <span>
                    {t("feedback.markdownSupported", "Markdown supported")} · Ctrl+B Ctrl+I Ctrl+K
                  </span>
                  <span>
                    {feedbackData.message.trim() ? feedbackData.message.trim().split(/\s+/).length : 0} {t("feedback.words", "words")} · {feedbackData.message.length} {t("feedback.chars", "chars")}
                  </span>
                </div>
              </div>
            ) : (
              <div className="px-5 py-4 min-h-[200px] bg-background text-sm prose prose-sm dark:prose-invert max-w-none
                prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
                prose-p:text-foreground prose-p:leading-relaxed prose-p:my-2
                prose-strong:text-foreground
                prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:p-3
                prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-muted-foreground
                prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
                prose-hr:border-border
                prose-table:border-collapse prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-1.5 prose-th:bg-muted/50 prose-th:text-left prose-th:text-xs prose-th:font-semibold
                prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-1.5 prose-td:text-xs
                prose-img:rounded-lg prose-img:max-w-full">
                {feedbackData.message ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Render task list checkboxes
                      input: ({ type, checked, ...props }) =>
                        type === "checkbox" ? (
                          <input type="checkbox" checked={checked} readOnly className="mr-1.5 rounded" {...props} />
                        ) : (
                          <input type={type} {...props} />
                        ),
                      // Open links in new tab
                      a: ({ children, ...props }) => (
                        <a target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
                      ),
                    }}
                  >
                    {feedbackData.message}
                  </ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">{t("feedback.previewEmpty", "Nothing to preview")}</p>
                )}
              </div>
            )}
          </div>
        </FormSection>

        {/* Image Upload */}
        <FormSection title={t("feedback.image")}>
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileInputChange}
              className="hidden"
            />

            {/* Image previews */}
            {imagePreviews.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {imagePreviews.map((preview, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={preview}
                      alt={`${t("feedback.imagePreview")} ${index + 1}`}
                      className="h-32 rounded-lg border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute top-1 right-1 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors opacity-0 group-hover:opacity-100"
                      title={t("feedback.removeImage")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <p className="mt-1 text-[10px] text-muted-foreground truncate max-w-[128px]">
                      {feedbackData.images[index]?.name}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Drop zone — always visible so user can add more */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors
                ${isDragging
                  ? 'border-primary bg-accent'
                  : 'border-border hover:border-muted-foreground hover:bg-muted/50'
                }
              `}
            >
              <ImagePlus className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium text-foreground">
                {t("feedback.imageDropzone")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("feedback.imageFormats")}
              </p>
            </div>
          </div>
        </FormSection>

        {/* Rating */}
        <FormSection title={t("feedback.rating")}>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{t("feedback.ratingDescription")}</span>
            <Rating 
              value={feedbackData.rating} 
              onChange={(value) => updateField("rating", value)} 
            />
          </div>
        </FormSection>

        {/* Submit */}
        <FormSection title="">
          <div className="space-y-4">
            {loading && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">{t("feedback.submittingMessage")}</p>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div className="bg-primary h-1.5 rounded-full animate-pulse w-2/3" />
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <button
                type="submit"
                disabled={!isFormValid || loading}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-w-36"
              >
                <Send className="w-4 h-4" />
                {loading ? t("feedback.submitting") : t("feedback.submit")}
              </button>

              <p className="text-xs text-muted-foreground text-center sm:text-left">
                {t("feedback.gdprNotice")}
              </p>
            </div>
          </div>
        </FormSection>
      </form>

      {/* Snackbar */}
      <Snackbar
        {...snackbar}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
      />
    </div>
  );
};

