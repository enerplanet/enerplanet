import { useState } from "react";
import { AxiosRequestConfig, Method, AxiosError } from "axios";
import axios from "@/lib/axios";

type FormDataPrimitive = string | number | boolean | File | null;
export type FormDataConvertible = FormDataPrimitive | FormDataPrimitive[];

interface VisitOptions extends AxiosRequestConfig {
	onStart?: () => void;
	onFinish?: () => void;
	onSuccess?: (data: unknown) => void;
	onError?: (errors: Record<string, string>, data?: unknown, statusCode?: number) => void;
}

export interface FormDataType {
	[key: string]: FormDataConvertible;
}

interface InertiaFormProps<TForm extends FormDataType> {
	data: TForm;
	isDirty: boolean;
	errors: Partial<Record<keyof TForm, string>>;
	hasErrors: boolean;
	isLoading: boolean;
	progress: number | null;
	wasSuccessful: boolean;
	recentlySuccessful: boolean;
	setData: (field: keyof TForm, value: FormDataConvertible) => void;
	setDefaults: (fields?: Partial<TForm>) => void;
	reset: (...fields: (keyof TForm)[]) => void;
	clearErrors: (...fields: (keyof TForm)[]) => void;
	setError: (errors: Partial<Record<keyof TForm, string>>) => void;
	submit: (method: Method, url: string, options?: VisitOptions) => Promise<void>;
	get: (url: string, options?: VisitOptions) => Promise<void>;
	post: (url: string, options?: VisitOptions) => Promise<void>;
	put: (url: string, options?: VisitOptions) => Promise<void>;
	patch: (url: string, options?: VisitOptions) => Promise<void>;
	delete: (url: string, options?: VisitOptions) => Promise<void>;
	cancel: () => void;
}

export function useForm<TForm extends FormDataType>(initialData: TForm): InertiaFormProps<TForm> {
	const [data, setData] = useState<TForm>(initialData);
	const [errors, setErrors] = useState<Partial<Record<keyof TForm, string>>>({});
	const [isLoading, setIsLoading] = useState(false);
	const [wasSuccessful, setWasSuccessful] = useState(false);
	const [recentlySuccessful, setRecentlySuccessful] = useState(false);
	const [isDirty, setIsDirty] = useState(false);
	const [progress, setProgress] = useState<number | null>(null);

	const updateData = (field: keyof TForm, value: FormDataConvertible) => {
		setData((prev) => ({ ...prev, [field]: value }));
		setIsDirty(true);
	};

	const setDefaults = (fields?: Partial<TForm>) => {
		setData((prev) => ({ ...prev, ...fields }));
	};

	const reset = (...fields: (keyof TForm)[]) => {
		if (fields.length > 0) {
			const updatedData = { ...data };
			for (const field of fields) {
				updatedData[field] = initialData[field];
			}
			setData(updatedData);
		} else {
			setData(initialData);
		}
		setIsDirty(false);
	};

	const clearErrors = (...fields: (keyof TForm)[]) => {
		if (fields.length > 0) {
			const updatedErrors = { ...errors };
			for (const field of fields) {
				delete updatedErrors[field];
			}
			setErrors(updatedErrors);
		} else {
			setErrors({});
		}
	};

	const setError = (errors: Partial<Record<keyof TForm, string>>) => {
		setErrors(errors);
	};

	const submit = async (method: Method, url: string, options?: VisitOptions) => {
		setIsLoading(true);
		options?.onStart?.();

		try {
			const response = await axios.request({
				method,
				url,
				data,
				onUploadProgress: (event) => {
					if (!event.total) {
						setProgress(null);
						return;
					}
					const percentCompleted = Math.round((event.loaded * 100) / event.total);
					setProgress(percentCompleted);
				},
				...options,
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
			});

			options?.onSuccess?.(response.data);
			if (response.status >= 200 && response.status < 300) clearErrors();
			setWasSuccessful(true);
			setRecentlySuccessful(true);
			setTimeout(() => setRecentlySuccessful(false), 2000);
		} catch (error: unknown) {
			const err = error as AxiosError<{ errors?: Record<string, string> }>;
			if (import.meta.env.DEV) console.error("Form submission error:", err);
			if (import.meta.env.DEV) console.error("Error response data:", err.response?.data);
			
			const responseData = err.response?.data || {};
			const responseErrors = responseData.errors || {};
			const statusCode = err.response?.status;
			
			setErrors(responseErrors as Partial<Record<keyof TForm, string>>);
			
			// Always call onError if provided, passing errors, response data, and status code
			if (options?.onError) {
				options.onError(responseErrors, responseData, statusCode);
			}
		} finally {
			setIsLoading(false);
			setProgress(null);
			options?.onFinish?.();
		}
	};

	const cancel = () => {
		setIsLoading(false);
		setProgress(null);
		setErrors({});
	};

	return {
		data,
		isDirty,
		errors,
		hasErrors: Object.keys(errors).length > 0,
		isLoading,
		progress,
		wasSuccessful,
		recentlySuccessful,
		setData: updateData,
		setDefaults,
		reset,
		clearErrors,
		setError,
		submit,
		get: (url, options) => submit("get", url, options),
		post: (url, options) => submit("post", url, options),
		put: (url, options) => submit("put", url, options),
		patch: (url, options) => submit("patch", url, options),
		delete: (url, options) => submit("delete", url, options),
		cancel,
	};
}
