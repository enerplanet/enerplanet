import React, { useEffect, useRef, useCallback } from 'react';
import { workspaceService, type Workspace } from '@/components/workspace/services/workspaceService';
import { UniversalForm } from '@spatialhub/forms';
import { getWorkspaceFormSections, validateWorkspaceForm } from '@/configuration/formConfigurations';
import { useForm, type FormDataType, type FormDataConvertible } from '@/hooks/useForm';
import { useTranslation } from '@spatialhub/i18n';

interface WorkspaceFormData extends FormDataType {
    name: string;
    description: string;
}

// ==================== Common Hook ====================

const useWorkspaceModalForm = (
    isOpen: boolean,
    onClose: () => void,
    workspace: Workspace | null,
    getInitialName?: (ws: Workspace) => string
) => {
    const form = useForm<WorkspaceFormData>({
        name: '',
        description: '',
    });

    const wasOpenRef = useRef<boolean>(isOpen);
    const getInitialNameRef = useRef(getInitialName);

    // Update the ref when getInitialName changes
    useEffect(() => {
        getInitialNameRef.current = getInitialName;
    }, [getInitialName]);

    // Store form methods in refs to avoid adding 'form' to deps
    const setDataRef = useRef(form.setData);
    const resetRef = useRef(form.reset);
    useEffect(() => {
        setDataRef.current = form.setData;
        resetRef.current = form.reset;
    }, [form.setData, form.reset]);

    useEffect(() => {
        if (isOpen && workspace) {
            const initialName = getInitialNameRef.current ? getInitialNameRef.current(workspace) : workspace.name;
            setDataRef.current('name', initialName);
            setDataRef.current('description', workspace.description || '');
        }
        if (wasOpenRef.current && !isOpen) {
            resetRef.current();
        }
        wasOpenRef.current = isOpen;
    }, [isOpen, workspace]);

    const handleClose = useCallback(() => {
        if (!form.isLoading) {
            form.reset();
            onClose();
        }
    }, [form, onClose]);

    const handleFormChange = useCallback((key: string, value: FormDataConvertible) => {
        form.setData(key as keyof WorkspaceFormData, value);
        if (form.errors[key as keyof WorkspaceFormData]) {
            form.clearErrors(key as keyof WorkspaceFormData);
        }
    }, [form]);

    return {
        form,
        handleClose,
        handleFormChange,
    };
};

interface RenameWorkspaceModalProps {
    isOpen: boolean;
    onClose: () => void;
    workspace: Workspace | null;
    onSuccess?: (workspace: Workspace) => void;
}

export const RenameWorkspaceModal: React.FC<RenameWorkspaceModalProps> = ({
    isOpen,
    onClose,
    workspace,
    onSuccess,
}) => {
    const { t } = useTranslation();
    const { form, handleClose, handleFormChange } = useWorkspaceModalForm(isOpen, onClose, workspace);

    if (!isOpen || !workspace) return null;

    const handleSubmit = async () => {
        const validationErrors = validateWorkspaceForm(form.data, t);

        if (Object.keys(validationErrors).length > 0) {
            form.setError(validationErrors as Partial<Record<keyof WorkspaceFormData, string>>);
            return;
        }

        try {
            await workspaceService.updateWorkspace(workspace.id, {
                name: form.data.name.trim(),
                description: form.data.description?.trim() || undefined,
            });

            const updatedWorkspace = {
                ...workspace,
                name: form.data.name.trim(),
                description: form.data.description?.trim() || ''
            };

            form.reset();
            onSuccess?.(updatedWorkspace);
            handleClose();
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to rename workspace:', error);
            form.setError({ name: 'Failed to rename workspace. Please try again.' });
        }
    };

    const formSections = getWorkspaceFormSections(t);

    return (
        <UniversalForm
            isOpen={isOpen}
            onClose={handleClose}
            title={t('workspace.renameWorkspace')}
            description={t('workspace.renameDescription')}
            variant="default"
            sections={formSections}
            values={form.data as unknown as Record<string, FormDataConvertible>}
            onChange={handleFormChange}
            onSubmit={handleSubmit}
            submitText={t('workspace.saveChanges')}
            loading={form.isLoading}
            errors={form.errors as Record<string, string>}
        />
    );
};

// ==================== Copy Workspace Modal ====================

interface CopyWorkspaceModalProps {
    isOpen: boolean;
    onClose: () => void;
    workspace: Workspace | null;
    onSuccess?: (workspace: Workspace, sourceWorkspace: Workspace) => void;
}

export const CopyWorkspaceModal: React.FC<CopyWorkspaceModalProps> = ({
    isOpen,
    onClose,
    workspace,
    onSuccess,
}) => {
    const { t } = useTranslation();
    const { form, handleClose, handleFormChange } = useWorkspaceModalForm(
        isOpen,
        onClose,
        workspace,
        (ws) => `${ws.name} (Copy)`
    );

    if (!isOpen || !workspace) return null;

    const handleSubmit = async () => {
        const validationErrors = validateWorkspaceForm(form.data, t);

        if (Object.keys(validationErrors).length > 0) {
            form.setError(validationErrors as Partial<Record<keyof WorkspaceFormData, string>>);
            return;
        }

        try {
            const copiedWorkspace = await workspaceService.copyWorkspace(
                workspace.id,
                form.data.name.trim(),
                form.data.description?.trim() || undefined
            );

            form.reset();
            onSuccess?.(copiedWorkspace, workspace);
            handleClose();
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to copy workspace:', error);
            form.setError({ name: 'Failed to copy workspace. Please try again.' });
        }
    };

    const formSections = getWorkspaceFormSections(t);

    return (
        <UniversalForm
            isOpen={isOpen}
            onClose={handleClose}
            title={t('workspace.copyWorkspaceTitle')}
            description={t('workspace.copyDescription')}
            variant="default"
            sections={formSections}
            values={form.data as unknown as Record<string, FormDataConvertible>}
            onChange={handleFormChange}
            onSubmit={handleSubmit}
            submitText={t('workspace.copyWorkspace')}
            loading={form.isLoading}
            errors={form.errors as Record<string, string>}
        />
    );
};
