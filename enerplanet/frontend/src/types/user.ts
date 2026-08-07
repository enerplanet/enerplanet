export interface User {
	id: string | number;
	name: string;
	email: string;
	access_level: "very_low" | "intermediate" | "manager" | "expert";
	model_limit?: number;
	created_at?: number;
	updated_at?: string;
}
