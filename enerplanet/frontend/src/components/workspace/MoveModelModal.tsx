import React, { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FormDataConvertible } from '@/hooks/useForm';
import { workspaceService, type Workspace } from '@/components/workspace/services/workspaceService';
import { modelService, type Model } from '@/features/model-dashboard/services/modelService';
import { UniversalForm } from '@spatialhub/forms';
import { getMoveModelFormSections, getWorkspaceFormSections, validateWorkspaceForm } from '@/configuration/formConfigurations';
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
    // Used only when there is no other workspace: the models move into a new one with this name.
    const [newWorkspaceName, setNewWorkspaceName] = useState('');

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
            setNewWorkspaceName('');
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

    const moveTo = async (workspaceId: number) => {
        if (isBulkMove) {
            await modelService.bulkMoveModels(models.map(m => m.id), workspaceId);
        } else {
            await modelService.moveModel(model!.id, workspaceId);
        }
    };

    /** Creates the named workspace and moves the models into it, for when no other workspace exists. */
    const handleCreateAndMove = async () => {
        const errors = validateWorkspaceForm({ name: newWorkspaceName }, t);
        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            return;
        }
        setIsSubmitting(true);
        setFormErrors({});
        try {
            const workspace = await workspaceService.createWorkspace({ name: newWorkspaceName.trim() });
            await moveTo(workspace.id);
            queryClient.invalidateQueries({ queryKey: ["models", "list"] });
            queryClient.invalidateQueries({ queryKey: ["models", "stats"] });
            onSuccess?.();
            setIsSubmitting(false);
            handleClose();
        } catch (error) {
            if (import.meta.env.DEV) console.error(`Failed to create workspace "${newWorkspaceName}" and move model(s):`, error);
            setFormErrors({ name: t('forms.moveModel.createAndMoveFailed') });
            setIsSubmitting(false);
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
            await moveTo(formData.workspace_id);

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
        const [details] = getWorkspaceFormSections(t);
        const nameSection = { ...details, fields: details.fields.filter((field) => field.key === 'name') };
        return (
            <UniversalForm
                isOpen={isOpen}
                onClose={handleClose}
                title={isBulkMove ? MOVE_MODELS_TITLE : MOVE_MODEL_TITLE}
                description={t('forms.moveModel.noOtherWorkspace')}
                variant="default"
                sections={[nameSection]}
                values={{ name: newWorkspaceName }}
                onChange={(key, value) => {
                    if (key !== 'name') return;
                    setNewWorkspaceName(String(value ?? ''));
                    setFormErrors({});
                }}
                onSubmit={handleCreateAndMove}
                submitText={t('forms.moveModel.createAndMove')}
                loading={isSubmitting}
                errors={formErrors}
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

