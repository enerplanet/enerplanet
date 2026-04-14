import React, { useState } from 'react';
import type { FormDataConvertible } from "@/hooks/useForm";
import type { Model } from '@/features/model-dashboard/services/modelService';
import { UniversalForm } from '@spatialhub/forms';
import { getBulkCopyFormSections, validateBulkCopyForm } from '@/configuration/formConfigurations';
import { useTranslation } from '@spatialhub/i18n';

interface BulkCopyModalProps {
  isOpen: boolean;
  models: Model[];
  onClose: () => void;
  onCopy: (model: Model) => Promise<void>;
  onSuccess?: () => void;
}

export const BulkCopyModal: React.FC<BulkCopyModalProps> = ({
  isOpen,
  models,
  onClose,
  onCopy,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<{ copyCount: number }>({ copyCount: 1 });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });

  const handleFormChange = (key: string, value: FormDataConvertible) => {
    setFormData((prev) => ({
      ...prev,
      [key]: key === 'copyCount' ? Number(value) : value,
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
    const validationErrors = validateBulkCopyForm(formData, t);
    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setFormErrors({});

    const total = models.length * formData.copyCount;
    setProgress({ completed: 0, total });

    try {
      let completed = 0;
      for (const model of models) {
        for (let i = 0; i < formData.copyCount; i++) {
          await onCopy(model);
          completed++;
          setProgress({ completed, total });
        }
      }
      handleClose();
      onSuccess?.();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to bulk copy models:', error);
      setFormErrors({ copyCount: t('model.bulkCopyFailed') });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setFormData({ copyCount: 1 });
      setFormErrors({});
      setProgress({ completed: 0, total: 0 });
      onClose();
    }
  };

  if (!isOpen || models.length === 0) return null;

  const formSections = getBulkCopyFormSections(t);

  const description = t('model.bulkCopyDescription', { count: models.length });

  return (
    <UniversalForm
      isOpen={isOpen}
      onClose={handleClose}
      title={t('model.bulkCopy')}
      description={description}
      variant="default"
      sections={formSections}
      values={formData as unknown as Record<string, FormDataConvertible>}
      onChange={handleFormChange}
      onSubmit={handleSubmit}
      submitText={t('model.bulkCopySubmit')}
      loading={isSubmitting}
      errors={formErrors}
      beforeSubmitContent={isSubmitting ? (
        <p className="text-xs font-medium text-foreground -mt-2">
          {progress.completed} / {progress.total}
        </p>
      ) : undefined}
    />
  );
};
