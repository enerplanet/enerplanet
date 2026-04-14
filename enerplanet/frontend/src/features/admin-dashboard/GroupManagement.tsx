import { useState, useEffect, useRef } from "react";
import { groupService, type Group } from "@/components/workspace/services/groupService";
import { UniversalForm } from "@spatialhub/forms";
import type { FormDataConvertible } from "@/hooks/useForm";
import { useTranslation } from "@spatialhub/i18n";

interface GroupManagementProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess?: (group: Group) => void;
	onNotification?: (message: string, severity: "success" | "error" | "warning" | "info") => void;
}

interface GroupFormData {
	name: string;
}

export const GroupManagement = ({ isOpen, onClose, onSuccess, onNotification }: GroupManagementProps) => {
	const { t } = useTranslation();
	const [formData, setFormData] = useState<GroupFormData>({ name: "" });
	const [isLoading, setIsLoading] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});

	const wasOpenRef = useRef<boolean>(isOpen);
	useEffect(() => {
		if (wasOpenRef.current && !isOpen) {
			setFormData({ name: "" });
			setErrors({});
		}
		wasOpenRef.current = isOpen;
	}, [isOpen]);

	if (!isOpen) return null;

	const handleClose = () => {
		if (!isLoading) {
			setFormData({ name: "" });
			setErrors({});
			onClose();
		}
	};

	const handleFormChange = (key: string, value: FormDataConvertible) => {
		setFormData({ ...formData, [key]: value as string });
		if (errors[key]) {
			setErrors({ ...errors, [key]: "" });
		}
	};

	const handleSubmit = async () => {
		if (!formData.name.trim()) {
			setErrors({ name: t("userManagement.groups.groupNameRequired") });
			return;
		}

		setIsLoading(true);
		try {
			await groupService.createGroup({ name: formData.name.trim() });
			onNotification?.(t("userManagement.groups.groupCreated"), "success");
			setFormData({ name: "" });
			setErrors({});
			onSuccess?.({ id: "", name: formData.name, path: "" });
			handleClose();
		} catch (error) {
			if (import.meta.env.DEV) console.error("Failed to create group:", error);
			onNotification?.(t("userManagement.groups.failedToCreateGroup"), "error");
			setErrors({ name: t("userManagement.groups.failedToCreateGroup") });
		} finally {
			setIsLoading(false);
		}
	};

	const formSections = [
		{
			title: "",
			fields: [
				{
					key: "name",
					label: t("userManagement.groups.groupName"),
					type: "text" as const,
					required: true,
					placeholder: t("userManagement.groups.groupNamePlaceholder"),
				},
			],
		},
	];

	return (
		<UniversalForm
			isOpen={isOpen}
			onClose={handleClose}
			title={t("userManagement.groups.createNewGroup")}
			description={t("userManagement.groups.createGroupDescription")}
			variant="default"
			sections={formSections}
			values={formData as unknown as Record<string, FormDataConvertible>}
			onChange={handleFormChange}
			onSubmit={handleSubmit}
			submitText={t("userManagement.groups.createGroup")}
			loading={isLoading}
			errors={errors}
		/>
	);
};
