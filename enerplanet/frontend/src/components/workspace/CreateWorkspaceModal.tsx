import React, { useEffect, useRef } from 'react';
import { workspaceService, type Workspace } from '@/components/workspace/services/workspaceService';
import { UniversalForm } from '@spatialhub/forms';
import { getWorkspaceFormSections, validateWorkspaceForm } from '@/configuration/formConfigurations';
import { useForm, type FormDataType, type FormDataConvertible } from '@/hooks/useForm';
import { useTranslation } from '@spatialhub/i18n';

interface CreateWorkspaceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (workspace: Workspace) => void;
}

interface WorkspaceFormData extends FormDataType {
    name: string;
    description: string;
}

export const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
}) => {
    const { t } = useTranslation();
    const form = useForm<WorkspaceFormData>({
        name: '',
        description: '',
    });

    // Only reset when transitioning from open -> closed to avoid render loops
    const wasOpenRef = useRef<boolean>(isOpen);
    useEffect(() => {
        if (wasOpenRef.current && !isOpen) {
            form.reset();
        }
        wasOpenRef.current = isOpen;
    }, [isOpen, form]);

    if (!isOpen) return null;

    const handleClose = () => {
        if (!form.isLoading) {
            form.reset();
            onClose();
        }
    };

    const handleFormChange = (key: string, value: FormDataConvertible) => {
        form.setData(key as keyof WorkspaceFormData, value);
        if (form.errors[key as keyof WorkspaceFormData]) {
            form.clearErrors(key as keyof WorkspaceFormData);
        }
    };

    const handleSubmit = async () => {
        const validationErrors = validateWorkspaceForm(form.data, t);

        if (Object.keys(validationErrors).length > 0) {
            form.setError(validationErrors as Partial<Record<keyof WorkspaceFormData, string>>);
            return;
        }

        try {
            const newWorkspace = await workspaceService.createWorkspace({
                name: form.data.name.trim(),
                description: form.data.description?.trim() || undefined,
            });

            form.reset();
            onSuccess?.(newWorkspace);
            handleClose();
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to create workspace:', error);
            form.setError({ name: 'Failed to create workspace. Please try again.' });
        }
    };

    const formSections = getWorkspaceFormSections(t);

    return (
        <UniversalForm
            isOpen={isOpen}
            onClose={handleClose}
            title={t('workspace.createNewWorkspace')}
            description={t('workspace.createDescription')}
            variant="default"
            sections={formSections}
            values={form.data as unknown as Record<string, FormDataConvertible>}
            onChange={handleFormChange}
            onSubmit={handleSubmit}
            submitText={t('workspace.createWorkspace')}
            loading={form.isLoading}
            errors={form.errors as Record<string, string>}
        />
    );
};

