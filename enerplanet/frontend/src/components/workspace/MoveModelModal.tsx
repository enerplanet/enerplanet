import React, { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FormDataConvertible } from '@/hooks/useForm';
import { workspaceService, type Workspace } from '@/components/workspace/services/workspaceService';
import { modelService, type Model } from '@/features/model-dashboard/services/modelService';
import { UniversalForm } from '@spatialhub/forms';
import { getMoveModelFormSections } from '@/configuration/formConfigurations';
import { useTranslation } from '@spatialhub/i18n';

const MOVE_MODEL_TITLE = 'Move Model';
const MOVE_MODELS_TITLE = 'Move Models';

function getModalDescription(isBulkMove: boolean, moveCount: number, modelTitle?: string): string {
    if (isBulkMove) {
        return `Move ${moveCount} selected model${moveCount > 1 ? 's' : ''} to a different workspace`;
    }
    return `Move "${modelTitle}" to a different workspace`;
}

function getSubmitText(isBulkMove: boolean, moveCount: number): string {
    if (isBulkMove) {
        return `Move ${moveCount} Model${moveCount > 1 ? 's' : ''}`;
    }
    return MOVE_MODEL_TITLE;
}

interface MoveModelModalProps {
    isOpen: boolean;
    model: Model | null;
    models?: Model[];
    currentWorkspaceId: number | null;
    onClose: () => void;
    onSuccess?: () => void;
}

export const MoveModelModal: React.FC<MoveModelModalProps> = ({
    isOpen,
    model,
    models,
    currentWorkspaceId,
    onClose,
    onSuccess,
}) => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<{ workspace_id: number | null }>({
        workspace_id: null,
    });
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    const loadWorkspaces = useCallback(async () => {
        setIsLoading(true);
        try {
            const allWorkspaces = await workspaceService.getUserWorkspaces();
            const availableWorkspaces = allWorkspaces.filter(
                ws => ws.id !== currentWorkspaceId
            );
            setWorkspaces(availableWorkspaces);

            if (availableWorkspaces.length > 0) {
                const firstWorkspaceId = availableWorkspaces[0].id;
                setFormData({ workspace_id: firstWorkspaceId });
            } else {
                setFormData({ workspace_id: null });
            }
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to load workspaces:', error);
        } finally {
            setIsLoading(false);
        }
    }, [currentWorkspaceId]);

    useEffect(() => {
        if (isOpen) {
            loadWorkspaces();
        }
    }, [isOpen, loadWorkspaces]);

    if (!isOpen || (!model && (!models || models.length === 0))) return null;

    const isBulkMove = models && models.length > 0;
    const moveCount = isBulkMove ? models.length : 1;

    const handleClose = () => {
        if (!isSubmitting) {
            setFormData({ workspace_id: null });
            setFormErrors({});
            onClose();
        }
    };

    const handleFormChange = (key: string, value: FormDataConvertible) => {
        const processedValue = key === 'workspace_id' && value !== '' ? Number(value) : value;

        setFormData((prev) => ({
            ...prev,
            [key]: processedValue,
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
        if (!formData.workspace_id) {
            setFormErrors({ workspace_id: 'Please select a workspace' });
            return;
        }

        setIsSubmitting(true);
        setFormErrors({});

        try {
            if (isBulkMove) {
                const modelIds = models.map(m => m.id);
                await modelService.bulkMoveModels(modelIds, formData.workspace_id);
            } else {
                await modelService.moveModel(model!.id, formData.workspace_id);
            }

            // Invalidate all model list caches across all workspaces
            queryClient.invalidateQueries({ queryKey: ["models", "list"] });
            queryClient.invalidateQueries({ queryKey: ["models", "stats"] });

            onSuccess?.();
            handleClose();
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to move model(s):', error);
            setFormErrors({
                workspace_id: isBulkMove
                    ? 'Failed to move models. Please try again.'
                    : 'Failed to move model. Please try again.'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return null;
    }

    if (workspaces.length === 0) {
        return (
            <UniversalForm
                isOpen={isOpen}
                onClose={handleClose}
                title={isBulkMove ? MOVE_MODELS_TITLE : MOVE_MODEL_TITLE}
                description="No other workspaces available. Create a new workspace first."
                variant="default"
                sections={[]}
                values={{}}
                onChange={() => {}}
                onSubmit={handleClose}
                submitText="Close"
                loading={false}
                errors={{}}
            />
        );
    }

    const formSections = getMoveModelFormSections(workspaces, t);

    return (
        <UniversalForm
            isOpen={isOpen}
            onClose={handleClose}
            title={isBulkMove ? 'Move Models' : 'Move Model'}
            description={getModalDescription(isBulkMove ?? false, moveCount, model?.title)}
            variant="default"
            sections={formSections}
            values={formData as unknown as Record<string, FormDataConvertible>}
            onChange={handleFormChange}
            onSubmit={handleSubmit}
            submitText={getSubmitText(isBulkMove ?? false, moveCount)}
            loading={isSubmitting}
            errors={formErrors}
        />
    );
};

