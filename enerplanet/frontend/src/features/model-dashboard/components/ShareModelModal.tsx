import React, { useEffect, useMemo, useState } from 'react';
import { Mail, UserMinus } from 'lucide-react';
import type { FormDataConvertible } from "@/hooks/useForm";
import {
  modelService,
  type Model,
  type ModelShare,
} from '@/features/model-dashboard/services/modelService';
import { UniversalForm } from '@spatialhub/forms';
import { getShareModelFormSections, validateShareModelForm } from '@/configuration/formConfigurations';
import { useWorkspaceStore } from '@/components/workspace/store/workspace-store';
import { useTranslation } from '@spatialhub/i18n';

interface ShareModelModalProps {
  isOpen: boolean;
  model: Model | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export const ShareModelModal: React.FC<ShareModelModalProps> = ({
  isOpen,
  model,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<{ email: string }>({
    email: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shares, setShares] = useState<ModelShare[]>([]);
  const [revokingShareId, setRevokingShareId] = useState<number | null>(null);
  const [revokeError, setRevokeError] = useState('');
  const currentWorkspace = useWorkspaceStore(state => state.currentWorkspace);

  useEffect(() => {
    if (!isOpen || !model) return;
    setShares(model.shares ?? []);
    setRevokeError('');
    setRevokingShareId(null);
  }, [isOpen, model]);

  const workspaceMemberEmails = useMemo(() => {
    return (currentWorkspace?.members || []).map(m => (m.email || '').toLowerCase());
  }, [currentWorkspace]);

  const handleFormChange = (key: string, value: FormDataConvertible) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));

    if (formErrors[key]) {
      setFormErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  const handleSubmit = async () => {
    if (!model) return;

    const validationErrors = validateShareModelForm(formData, t);
    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setFormErrors({});

    try {
      const inputEmail = formData.email.trim().toLowerCase();

      // Check workspace access
      if (shouldSkipWorkspaceMemberShare(model, inputEmail, workspaceMemberEmails)) {
        setFormErrors({ email: 'This user already has access through the workspace that contains this model.' });
        setIsSubmitting(false);
        return;
      }

      const response = await modelService.shareModel(model.id, inputEmail);

      setFormData({ email: '' });
      if (response.data) {
        setShares((current) => [
          ...current.filter((share) => share.id !== response.data.id),
          response.data,
        ]);
      }
      onSuccess?.();
    } catch (error: unknown) {
      const errorMessage = extractShareErrorMessage(error);
      if (import.meta.env.DEV) console.error('Failed to share model:', error);
      setFormErrors({ email: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (share: ModelShare) => {
    if (!model || isSubmitting || revokingShareId !== null) return;

    setRevokingShareId(share.id);
    setRevokeError('');
    try {
      await modelService.revokeModelShare(model.id, share.id);
      setShares((current) => current.filter((item) => item.id !== share.id));
      onSuccess?.();
    } catch (error: unknown) {
      setRevokeError(extractRevokeErrorMessage(error));
    } finally {
      setRevokingShareId(null);
    }
  };

  const handleClose = () => {
    if (!isSubmitting && revokingShareId === null) {
      setFormData({ email: '' });
      setFormErrors({});
      setRevokeError('');
      onClose();
    }
  };

  if (!isOpen || !model) return null;

  const formSections = getShareModelFormSections(t);

  return (
    <UniversalForm
      isOpen={isOpen}
      onClose={handleClose}
      title={t('model.share')}
      description={t('model.shareDescription', { title: model.title })}
      variant="default"
      sections={formSections}
	  values={formData as unknown as Record<string, FormDataConvertible>}
      onChange={handleFormChange}
      onSubmit={handleSubmit}
      submitText={t('model.share')}
      loading={isSubmitting}
      errors={formErrors}
      maxWidth="lg"
      beforeSubmitContent={
        <DirectShareList
          shares={shares}
          revokingShareId={revokingShareId}
          disabled={isSubmitting}
          error={revokeError}
          onRevoke={handleRevoke}
          t={t}
        />
      }
    />
  );
};

interface DirectShareListProps {
  shares: ModelShare[];
  revokingShareId: number | null;
  disabled: boolean;
  error: string;
  onRevoke: (share: ModelShare) => void;
  t: ReturnType<typeof useTranslation>['t'];
}

const DirectShareList: React.FC<DirectShareListProps> = ({
  shares,
  revokingShareId,
  disabled,
  error,
  onRevoke,
  t,
}) => {
  const orderedShares = [...shares].sort((a, b) => a.email.localeCompare(b.email));

  return (
    <section className="border-t border-border pt-4" aria-labelledby="direct-model-shares-title">
      <div className="mb-2">
        <h3 id="direct-model-shares-title" className="text-sm font-semibold text-foreground">
          {t('model.peopleWithAccess', 'People with direct access')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('model.peopleWithAccessDescription', 'Users listed here can open this model and its results.')}
        </p>
      </div>

      {orderedShares.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          {t('model.noDirectShares', 'This model has not been shared with anyone yet.')}
        </p>
      ) : (
        <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
          {orderedShares.map((share) => {
            const isRevoking = revokingShareId === share.id;
            return (
              <div
                key={share.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{share.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {share.permission === 'edit'
                        ? t('model.canEdit', 'Can edit')
                        : t('model.canView', 'Can view')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={disabled || revokingShareId !== null}
                  onClick={() => onRevoke(share)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('model.revokeAccessFor', `Revoke access for ${share.email}`)}
                >
                  <UserMinus className="size-3.5" aria-hidden="true" />
                  {isRevoking
                    ? t('model.revokingAccess', 'Revoking…')
                    : t('model.revokeAccess', 'Revoke')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
};

// Helper functions
function shouldSkipWorkspaceMemberShare(
  model: Model,
  inputEmail: string,
  workspaceMemberEmails: string[]
): boolean {
  return Boolean(model.workspace_id && workspaceMemberEmails.includes(inputEmail));
}

function extractShareErrorMessage(error: unknown): string {
  const message = 'Failed to share model. Please try again.';

  if (isAxiosError(error)) {
    const rawMsg = error.response?.data?.error || error.response?.data?.message || '';
    const lower = rawMsg.toLowerCase();

    if (error.response?.status === 400) {
      if (lower.includes('already shared')) {
        return 'This model is already shared with that user.';
      } else if (lower.includes('workspace already shared')) {
        return 'This user already has access through the workspace that contains this model.';
      }
    } else if (rawMsg) {
      return rawMsg;
    }
  } else if (hasMessage(error)) {
    return String(error.message);
  }

  return message;
}

function extractRevokeErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const rawMsg = error.response?.data?.error || error.response?.data?.message;
    if (rawMsg) return rawMsg;
  } else if (hasMessage(error)) {
    return String(error.message);
  }
  return 'Failed to revoke access. Please try again.';
}

function isAxiosError(error: unknown): error is { response?: { status?: number; data?: { error?: string; message?: string } } } {
  return Boolean(error && typeof error === 'object' && 'response' in error);
}

function hasMessage(error: unknown): error is { message: string } {
  return Boolean(error && typeof error === 'object' && 'message' in error);
}

