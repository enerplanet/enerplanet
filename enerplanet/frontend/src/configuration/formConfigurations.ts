import {
	User,
	Mail,
	Building,
	Briefcase,
	Phone,
	Shield,
	Lock,
	Cloud,
	Monitor,
	Globe,
	Hash,
	FileText,
	ToggleLeft,
	Server,
	FolderInput,
	Folder,
	Gauge,
	Copy,
} from "lucide-react";
import { FormSection } from "@spatialhub/forms";
import { isValidEmail } from "@/utils/email-validation";

type TranslateFunction = (key: string) => string;

export const getUserFormSections = (isEdit: boolean = false, t?: TranslateFunction, currentUserAccessLevel?: string): FormSection[] => [
	{
		title: t?.("forms.user.personalInfo.title") ?? "Personal Information",
		description: t?.("forms.user.personalInfo.description") ?? "Basic user details and contact information",
		columns: 2,
		fields: [
			{
				key: "name",
				label: t?.("forms.user.fields.fullName") ?? "Full Name",
				type: "text",
				value: "",
				placeholder: t?.("forms.user.placeholders.fullName") ?? "Enter full name",
				required: true,
				icon: User as any,
			},
			{
				key: "email",
				label: t?.("forms.user.fields.email") ?? "Email Address",
				type: "email",
				value: "",
				placeholder: t?.("forms.user.placeholders.email") ?? "Enter email address",
				required: true,
				icon: Mail as any,
			},
			{
				key: "organization",
				label: t?.("forms.user.fields.organization") ?? "Organization",
				type: "text",
				value: "",
				placeholder: t?.("forms.user.placeholders.organization") ?? "Enter organization name",
				icon: Building as any,
			},
			{
				key: "position",
				label: t?.("forms.user.fields.position") ?? "Position",
				type: "text",
				value: "",
				placeholder: t?.("forms.user.placeholders.position") ?? "Enter job position",
				icon: Briefcase as any,
			},
			{
				key: "phone",
				label: t?.("forms.user.fields.phone") ?? "Phone Number",
				type: "tel",
				value: "",
				placeholder: "+49 123 456 789",
				icon: Phone as any,
				validation: (value: FormValue) => {
					const v = typeof value === 'string' ? value : '';
					if (v && !/^[\d\s\-+()]+$/.test(v)) {
						return t?.("forms.user.validation.phoneInvalid") ?? "Phone number can only contain digits, spaces, dashes, plus signs, and parentheses";
					}
					return null;
				},
			},
			{
				key: "access_level",
				label: t?.("forms.user.fields.accessLevel") ?? "Access Level",
				type: "select",
				value: "very_low",
				required: true,
				icon: Shield as any,
				description: "",
				options: [
					{ value: "very_low", label: t?.("forms.user.accessLevels.veryLow") ?? "Very Low Access" },
					{ value: "intermediate", label: t?.("forms.user.accessLevels.intermediate") ?? "Intermediate Access" },
					{ value: "manager", label: t?.("forms.user.accessLevels.manager") ?? "Manager (Group Access)" },
					{ value: "expert", label: t?.("forms.user.accessLevels.expert") ?? "Expert (Full Access)" },
				],
			},
						...(isEdit
							? ([
					{
						key: "email_verified",
						label: t?.("forms.user.fields.emailVerified") ?? "Email Verified",
						type: "checkbox",
						value: false,
						description: t?.("forms.user.descriptions.emailVerified") ?? "Mark email as verified",
						icon: Shield as any,
					},
							] as FormSection["fields"])
				: []),
			// Model limit field - only shown for experts when editing
			...(isEdit && currentUserAccessLevel === "expert"
				? ([
					{
						key: "model_limit",
						label: t?.("forms.user.fields.modelLimit") ?? "Model Limit",
						type: "number",
						value: undefined,
						placeholder: t?.("forms.user.placeholders.modelLimit") ?? "Leave empty for default",
						description: t?.("forms.user.descriptions.modelLimit") ?? "Custom model creation limit (0 = unlimited, empty = use default)",
						icon: Gauge as any,
						min: 0,
					},
				] as FormSection["fields"])
				: []),
		],
	},
	...(isEdit
		? []
					: ([
				{
					title: t?.("forms.user.security.title") ?? "Security",
					description: t?.("forms.user.security.description") ?? "Account security credentials",
					columns: 2,
					fields: [
						{
							key: "password",
							label: t?.("forms.user.fields.password") ?? "Password",
							type: "password",
							value: "",
							placeholder: t?.("forms.user.placeholders.password") ?? "Enter password",
							required: true,
							icon: Lock as any,
							showPasswordToggle: true,
							validation: (value: FormValue) => {
								const v = typeof value === 'string' ? value : '';
								if (v && v.length < 6) {
									return t?.("forms.user.validation.passwordLength") ?? "Password must be at least 8 characters long";
								}
								return null;
							},
						},
						{
							key: "password_confirmation",
							label: t?.("forms.user.fields.confirmPassword") ?? "Confirm Password",
							type: "password",
							value: "",
							placeholder: t?.("forms.user.placeholders.confirmPassword") ?? "Confirm password",
							required: true,
							icon: Lock as any,
							showPasswordToggle: true,
						},
											] as FormSection["fields"],
				},
			] as FormSection[])),
];

type FormValue = string | number | boolean;

export const getWebserviceFormSections = (t?: TranslateFunction): FormSection[] => [
	{
		title: t?.("forms.webservice.serviceInfo.title") ?? "Service Information",
		description: t?.("forms.webservice.serviceInfo.description") ?? "Basic webservice identification and metadata",
		columns: 2,
		fields: [
			            {
							key: "name",
							label: t?.("forms.webservice.fields.serviceName") ?? "Service Name",
							type: "text",
							value: "",
							placeholder: t?.("forms.webservice.placeholders.serviceName") ?? "Enter service name",
							required: true,
							icon: Cloud as any,
							description: t?.("forms.webservice.descriptions.serviceName") ?? "Human-readable name for the webservice",
						},
					],
				},
				{
					title: t?.("forms.webservice.connectionDetails.title") ?? "Connection Details",
					description: t?.("forms.webservice.connectionDetails.description") ?? "Network connection and endpoint configuration",
					columns: 2,
					fields: [
						{
							key: "protocol",
							label: t?.("forms.webservice.fields.protocol") ?? "Protocol",
							type: "select",
							value: "http",
							required: true,
							icon: Globe as any,
							options: [
								{ value: "http", label: "HTTP" },
								{ value: "https", label: "HTTPS" },
							],
						},
						{
							key: "ip",
							label: t?.("forms.webservice.fields.ipAddress") ?? "IP Address / Hostname",
							type: "text",
							value: "",
							placeholder: t?.("forms.webservice.placeholders.ipAddress") ?? "e.g., 192.168.1.100 or sim-haproxy",
							required: true,
							icon: Monitor as any,
							validation: (value: FormValue) => {
								const v = typeof value === 'string' ? value : '';
								const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
									const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
								if (v && !ipRegex.test(v) && !hostnameRegex.test(v)) {
									return t?.("forms.webservice.validation.ipInvalid") ?? "Please enter a valid IP address or hostname";
								}
								return null;
							},
						},
						{
							key: "port",
							label: t?.("forms.webservice.fields.port") ?? "Port",
							type: "number",
							value: 8080,
							required: true,
							icon: Hash as any,
							min: 1,
							max: 65535,				validation: (value: FormValue) => {
					const num = typeof value === 'number' ? value : Number(value);
					if (num && (num < 1 || num > 65535)) {
						return t?.("forms.webservice.validation.portRange") ?? "Port must be between 1 and 65535";
					}
					return null;
				},
			},
			{
				key: "endpoint",
				label: t?.("forms.webservice.fields.endpoint") ?? "Endpoint Path",
				type: "text",
				value: "",
				placeholder: "/api/calculate",
				icon: Server as any,
				description: "",
			},
		],
	},
	{
		title: t?.("forms.webservice.performanceSettings.title") ?? "Performance Settings",
		description: t?.("forms.webservice.performanceSettings.description") ?? "Service capacity and performance configuration",
		columns: 2,
		fields: [
			{
				key: "auto_scaling",
				label: t?.("forms.webservice.fields.autoScaling") ?? "Auto Scaling",
				type: "checkbox",
				value: false,
				icon: ToggleLeft as any,
				description: t?.("forms.webservice.descriptions.autoScaling") ?? "Enable automatic scaling based on load",
			},
			{
				key: "max_concurrency",
				label: t?.("forms.webservice.fields.maxConcurrency") ?? "Max Concurrent Requests",
				type: "number",
				value: 1,
				required: true,
				icon: Hash as any,
				min: 1,
				max: 100,
				description: t?.("forms.webservice.descriptions.maxConcurrency") ?? "Maximum number of concurrent requests (1-100)",
				validation: (value: FormValue) => {
					const num = typeof value === 'number' ? value : Number(value);
					if (num && (num < 1 || num > 100)) {
						return t?.("forms.webservice.validation.concurrencyRange") ?? "Max concurrency must be between 1 and 100";
					}
					return null;
				},
			},
			{
				key: "status",
				label: t?.("forms.webservice.fields.initialStatus") ?? "Initial Status",
				type: "select",
				value: "inactive",
				required: true,
				icon: Shield as any,
				options: [
					{ value: "active", label: t?.("forms.webservice.statusOptions.active") ?? "Active" },
					{ value: "inactive", label: t?.("forms.webservice.statusOptions.inactive") ?? "Inactive" },
					{ value: "maintenance", label: t?.("forms.webservice.statusOptions.maintenance") ?? "Maintenance" },
				],
			},
		],
	},
];

export const validateUserForm = (values: Record<string, unknown>, isEdit: boolean = false, t?: TranslateFunction): Record<string, string> => {
	const errors: Record<string, string> = {};

	validateUserBasicFields(errors, values, t);
	
	if (!isEdit) {
		validateUserPasswords(errors, values, t);
	}

	return errors;
};

function validateUserBasicFields(errors: Record<string, string>, values: Record<string, unknown>, t?: TranslateFunction) {
	const name = typeof values.name === 'string' ? values.name : '';
	if (!name.trim()) {
		errors.name = t?.("forms.user.validation.nameRequired") ?? "Name is required";
	}

	const email = typeof values.email === 'string' ? values.email : '';
	if (!email.trim()) {
		errors.email = t?.("forms.user.validation.emailRequired") ?? "Email is required";
	} else if (!isValidEmail(email)) {
		errors.email = t?.("forms.user.validation.emailInvalid") ?? "Please enter a valid email address";
	}

	if (!values.access_level) {
		errors.access_level = t?.("forms.user.validation.accessLevelRequired") ?? "Access level is required";
	}
}

function validateUserPasswords(errors: Record<string, string>, values: Record<string, unknown>, t?: TranslateFunction) {
	// This is password validation logic, not a hard-coded password
	const password = typeof values.password === 'string' ? values.password : ''; // Not a hard-coded password, this is form validation
	if (!password) {
		errors.password = t?.("forms.user.validation.passwordRequired") ?? "Password is required"; //  This is an error message, not a credential
	} else if (password.length < 8) {
		errors.password = t?.("forms.user.validation.passwordLength") ?? "Password must be at least 8 characters long";
	}

	const password_confirmation = typeof values.password_confirmation === 'string' ? values.password_confirmation : '';
	if (!password_confirmation) {
		errors.password_confirmation = t?.("forms.user.validation.confirmPasswordRequired") ?? "Password confirmation is required";
	} else if (password !== password_confirmation) {
		errors.password_confirmation = t?.("forms.user.validation.passwordsMismatch") ?? "Passwords do not match";
	}
}

export const validateWebserviceForm = (values: Record<string, unknown>, t?: TranslateFunction): Record<string, string> => {
	const errors: Record<string, string> = {};

	const name = typeof values.name === 'string' ? values.name : '';
	if (name.trim() === '') {
		errors.name = t?.("forms.webservice.validation.nameRequired") ?? "Service name is required";
	}

	const ip = typeof values.ip === 'string' ? values.ip : '';
	if (ip.trim() === '') {
		errors.ip = t?.("forms.webservice.validation.ipRequired") ?? "IP address or hostname is required";
	} else {
		const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
		const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
		if (!ipRegex.test(ip) && !hostnameRegex.test(ip)) {
			errors.ip = t?.("forms.webservice.validation.ipInvalid") ?? "Please enter a valid IP address or hostname";
		}
	}

	const port = typeof values.port === 'number' ? values.port : Number(values.port);
	if (!port) {
		errors.port = t?.("forms.webservice.validation.portRequired") ?? "Port is required";
	} else if (port < 1 || port > 65535) {
		errors.port = t?.("forms.webservice.validation.portRange") ?? "Port must be between 1 and 65535";
	}

	return errors;
};

export const getPylovoFormSections = (t?: TranslateFunction): FormSection[] => [
	{
		title: t?.("forms.pylovo.serviceInfo.title") ?? "Service Information",
		description: t?.("forms.pylovo.serviceInfo.description") ?? "Basic pylovo instance identification",
		columns: 2,
		fields: [
			{
				key: "name",
				label: t?.("forms.pylovo.fields.serviceName") ?? "Service Name",
				type: "text",
				value: "",
				placeholder: t?.("forms.pylovo.placeholders.serviceName") ?? "Enter service name",
				required: true,
				icon: Cloud as any,
				description: t?.("forms.pylovo.descriptions.serviceName") ?? "Human-readable name for the pylovo instance",
			},
		],
	},
	{
		title: t?.("forms.pylovo.connectionDetails.title") ?? "Connection Details",
		description: t?.("forms.pylovo.connectionDetails.description") ?? "Network connection and endpoint configuration",
		columns: 2,
		fields: [
			{
				key: "protocol",
				label: t?.("forms.pylovo.fields.protocol") ?? "Protocol",
				type: "select",
				value: "http",
				required: true,
				icon: Globe as any,
				options: [
					{ value: "http", label: "HTTP" },
					{ value: "https", label: "HTTPS" },
				],
			},
			{
				key: "ip",
				label: t?.("forms.pylovo.fields.ipAddress") ?? "IP Address / Hostname",
				type: "text",
				value: "",
				placeholder: t?.("forms.pylovo.placeholders.ipAddress") ?? "e.g., pylovo-haproxy or 10.1.66.41",
				required: true,
				icon: Monitor as any,
				validation: (value: FormValue) => {
					const v = typeof value === 'string' ? value : '';
					const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
						const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
					if (v && !ipRegex.test(v) && !hostnameRegex.test(v)) {
						return t?.("forms.pylovo.validation.ipInvalid") ?? "Please enter a valid IP address or hostname";
					}
					return null;
				},
			},
			{
				key: "port",
				label: t?.("forms.pylovo.fields.port") ?? "Port",
				type: "number",
				value: 80,
				required: true,
				icon: Hash as any,
				min: 1,
				max: 65535,
				validation: (value: FormValue) => {
					const num = typeof value === 'number' ? value : Number(value);
					if (num && (num < 1 || num > 65535)) {
						return t?.("forms.pylovo.validation.portRange") ?? "Port must be between 1 and 65535";
					}
					return null;
				},
			},
			{
				key: "endpoint",
				label: t?.("forms.pylovo.fields.endpoint") ?? "Endpoint Path",
				type: "text",
				value: "",
				placeholder: "/health",
				icon: Server as any,
				description: "",
			},
		],
	},
	{
		title: t?.("forms.pylovo.statusSettings.title") ?? "Status",
		description: t?.("forms.pylovo.statusSettings.description") ?? "Initial status of the pylovo instance",
		columns: 2,
		fields: [
			{
				key: "status",
				label: t?.("forms.pylovo.fields.initialStatus") ?? "Initial Status",
				type: "select",
				value: "active",
				required: true,
				icon: Shield as any,
				options: [
					{ value: "active", label: t?.("forms.pylovo.statusOptions.active") ?? "Active" },
					{ value: "inactive", label: t?.("forms.pylovo.statusOptions.inactive") ?? "Inactive" },
					{ value: "maintenance", label: t?.("forms.pylovo.statusOptions.maintenance") ?? "Maintenance" },
				],
			},
		],
	},
];

export const validatePylovoForm = (values: Record<string, unknown>, t?: TranslateFunction): Record<string, string> => {
	const errors: Record<string, string> = {};

	const name = typeof values.name === 'string' ? values.name : '';
	if (name.trim() === '') {
		errors.name = t?.("forms.pylovo.validation.nameRequired") ?? "Service name is required";
	}

	const ip = typeof values.ip === 'string' ? values.ip : '';
	if (ip.trim() === '') {
		errors.ip = t?.("forms.pylovo.validation.ipRequired") ?? "IP address or hostname is required";
	} else {
		const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
		const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
		if (!ipRegex.test(ip) && !hostnameRegex.test(ip)) {
			errors.ip = t?.("forms.pylovo.validation.ipInvalid") ?? "Please enter a valid IP address or hostname";
		}
	}

	const port = typeof values.port === 'number' ? values.port : Number(values.port);
	if (!port) {
		errors.port = t?.("forms.pylovo.validation.portRequired") ?? "Port is required";
	} else if (port < 1 || port > 65535) {
		errors.port = t?.("forms.pylovo.validation.portRange") ?? "Port must be between 1 and 65535";
	}

	return errors;
};

export const getWorkspaceFormSections = (t?: TranslateFunction): FormSection[] => [
	{
		title: t?.("forms.workspace.details.title") ?? "Details",
		description: t?.("forms.workspace.details.description") ?? "Enter the workspace name and optional description",
		columns: 1,
		fields: [
			{
				key: "name",
				label: t?.("forms.workspace.fields.name") ?? "Workspace Name",
				type: "text",
				value: "",
				placeholder: t?.("forms.workspace.placeholders.name") ?? "Enter workspace name",
				required: true,
				icon: Folder as any,
				description: t?.("forms.workspace.descriptions.name") ?? "A unique name for your workspace",
			},
			{
				key: "description",
				label: t?.("forms.workspace.fields.description") ?? "Description",
				type: "textarea",
				value: "",
				placeholder: t?.("forms.workspace.placeholders.description") ?? "Enter workspace description (optional)",
				icon: FileText as any,
				rows: 3,
				description: t?.("forms.workspace.descriptions.description") ?? "Optional description of the workspace purpose",
			},
		],
	},
];

export const getMoveModelFormSections = (workspaces: Array<{id: number; name: string; is_default: boolean}>, t?: TranslateFunction): FormSection[] => [
	{
		title: t?.("forms.moveModel.destination.title") ?? "Destination",
		description: t?.("forms.moveModel.destination.description") ?? "Select the target workspace for the model",
		columns: 1,
		fields: [
			{
				key: "workspace_id",
				label: t?.("forms.moveModel.fields.targetWorkspace") ?? "Target Workspace",
				type: "select",
				value: "",
				placeholder: t?.("forms.moveModel.placeholders.selectWorkspace") ?? "Select a workspace",
				required: true,
				icon: FolderInput as any,
				options: workspaces.map(ws => ({
					value: String(ws.id),
					label: ws.is_default ? (t?.("forms.moveModel.defaultWorkspace") ?? 'Default Workspace') : ws.name
				})),
				description: t?.("forms.moveModel.descriptions.targetWorkspace") ?? "Choose the workspace to move the model to",
			},
		],
	},
];

export const validateWorkspaceForm = (values: Record<string, unknown>, t?: TranslateFunction): Record<string, string> => {
	const errors: Record<string, string> = {};

	const name = typeof values.name === 'string' ? values.name : '';
	if (!name.trim()) {
		errors.name = t?.("forms.workspace.validation.nameRequired") ?? "Workspace name is required";
	}

	return errors;
};

export const getShareModelFormSections = (t?: TranslateFunction): FormSection[] => [
	{
		title: t?.("forms.shareModel.title") ?? "Share with an Individual User",
		description: t?.("forms.shareModel.description") ?? "Enter the email address of the user to share with",
		columns: 1,
		fields: [
			{
				key: "email",
				label: t?.("forms.user.fields.email") ?? "Email Address",
				type: "email",
				value: "",
				placeholder: "name@email.com",
				required: true,
				icon: Mail as any,
				description: t?.("forms.shareModel.emailDescription") ?? "The user will get access to this model",
			},
		],
	},
];

export const validateShareModelForm = (values: Record<string, unknown>, t?: TranslateFunction): Record<string, string> => {
	const errors: Record<string, string> = {};

	const email = typeof values.email === 'string' ? values.email : '';
	if (!email.trim()) {
		errors.email = t?.("forms.user.validation.emailRequired") ?? "Email address is required";
	} else if (!isValidEmail(email)) {
		errors.email = t?.("forms.user.validation.emailInvalid") ?? "Please enter a valid email address";
	}

	return errors;
};

export const getBulkCopyFormSections = (t?: TranslateFunction): FormSection[] => [
	{
		title: t?.("forms.bulkCopy.title") ?? "Number of Copies",
		description: t?.("forms.bulkCopy.description") ?? "Specify how many copies to create for each selected model",
		columns: 1,
		fields: [
			{
				key: "copyCount",
				label: t?.("forms.bulkCopy.fields.copyCount") ?? "Number of Copies",
				type: "number",
				value: 1,
				placeholder: "1",
				required: true,
				icon: Copy as any,
				description: t?.("forms.bulkCopy.fields.copyCountDescription") ?? "Each selected model will be duplicated this many times",
				min: 1,
				max: 10,
			},
		],
	},
];

export const validateBulkCopyForm = (values: Record<string, unknown>, t?: TranslateFunction): Record<string, string> => {
	const errors: Record<string, string> = {};

	const copyCount = Number(values.copyCount);
	if (!copyCount || copyCount < 1) {
		errors.copyCount = t?.("forms.bulkCopy.validation.min") ?? "At least 1 copy is required";
	} else if (copyCount > 10) {
		errors.copyCount = t?.("forms.bulkCopy.validation.max") ?? "Maximum 10 copies allowed";
	} else if (!Number.isInteger(copyCount)) {
		errors.copyCount = t?.("forms.bulkCopy.validation.integer") ?? "Must be a whole number";
	}

	return errors;
};
