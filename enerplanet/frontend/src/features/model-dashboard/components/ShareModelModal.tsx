import React, { useMemo, useState } from 'react';
import type { FormDataConvertible } from "@/hooks/useForm";
import { modelService, type Model } from '@/features/model-dashboard/services/modelService';
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
  const currentWorkspace = useWorkspaceStore(state => state.currentWorkspace);

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

      await modelService.shareModel(model.id, inputEmail);

      setFormData({ email: '' });
      onSuccess?.();
      handleClose();
    } catch (error: unknown) {
      const errorMessage = extractShareErrorMessage(error);
      if (import.meta.env.DEV) console.error('Failed to share model:', error);
      setFormErrors({ email: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setFormData({ email: '' });
      setFormErrors({});
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
    />
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

function isAxiosError(error: unknown): error is { response?: { status?: number; data?: { error?: string; message?: string } } } {
  return Boolean(error && typeof error === 'object' && 'response' in error);
}

function hasMessage(error: unknown): error is { message: string } {
  return Boolean(error && typeof error === 'object' && 'message' in error);
}

