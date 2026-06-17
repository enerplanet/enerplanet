import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Plus, ShieldOff } from "lucide-react";
import { IconX } from "@tabler/icons-react";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogDescription,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { apiTokensService, type ApiToken, type CreatedApiToken } from "@/features/admin-dashboard/services/apiTokens";

interface ApiTokensDialogProps {
	user: { id: string | number; email: string } | null;
	isOpen: boolean;
	onClose: () => void;
}

function formatDate(value?: string | null): string {
	if (!value) return "—";
	return new Date(value).toLocaleDateString();
}

function tokenStatus(token: ApiToken): "active" | "revoked" | "expired" {
	if (token.revoked_at) return "revoked";
	if (token.expires_at && new Date(token.expires_at) < new Date()) return "expired";
	return "active";
}

export function ApiTokensDialog({ user, isOpen, onClose }: ApiTokensDialogProps) {
	const { t } = useTranslation();
	const [tokens, setTokens] = useState<ApiToken[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [name, setName] = useState("");
	const [scope, setScope] = useState<"read" | "full">("read");
	const [expiresInDays, setExpiresInDays] = useState(90);
	const [creating, setCreating] = useState(false);

	// Freshly created token (shown once).
	const [created, setCreated] = useState<CreatedApiToken | null>(null);
	const [copied, setCopied] = useState(false);

	const loadTokens = useCallback(async () => {
		if (!user) return;
		setLoading(true);
		setError(null);
		try {
			setTokens(await apiTokensService.list(user.id));
		} catch {
			setError(t("apiTokens.errors.load", "Failed to load tokens"));
		} finally {
			setLoading(false);
		}
	}, [user, t]);

	useEffect(() => {
		if (isOpen) {
			setCreated(null);
			setCopied(false);
			setName("");
			setScope("read");
			setExpiresInDays(90);
			loadTokens();
		}
	}, [isOpen, loadTokens]);

	const handleCreate = async () => {
		if (!user || !name.trim() || creating) return;
		setCreating(true);
		setError(null);
		try {
			const result = await apiTokensService.create(user.id, {
				name: name.trim(),
				scope,
				expires_in_days: expiresInDays,
			});
			setCreated(result);
			setName("");
			await loadTokens();
		} catch {
			setError(t("apiTokens.errors.create", "Failed to create token"));
		} finally {
			setCreating(false);
		}
	};

	const handleRevoke = async (token: ApiToken) => {
		if (!user) return;
		try {
			await apiTokensService.revoke(user.id, token.id);
			await loadTokens();
		} catch {
			setError(t("apiTokens.errors.revoke", "Failed to revoke token"));
		}
	};

	const handleCopy = async () => {
		if (!created) return;
		await navigator.clipboard.writeText(created.token);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	if (!user) return null;

	return (
		<AlertDialog open={isOpen} onOpenChange={onClose}>
			<AlertDialogContent className="!max-w-[42rem] max-h-[90vh] flex flex-col p-0 gap-0">
				<AlertDialogHeader className="p-6 border-b border-border relative">
					<AlertDialogTitle className="text-xl font-semibold text-foreground">
						{t("apiTokens.title", "API Tokens")}
					</AlertDialogTitle>
					<AlertDialogDescription className="text-sm text-muted-foreground mt-1">
						{t("apiTokens.subtitle", "Manage API access tokens for")} {user.email}
					</AlertDialogDescription>
					<button
						onClick={onClose}
						className="absolute right-3 top-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					>
						<IconX className="w-4 h-4" />
					</button>
				</AlertDialogHeader>

				<div className="p-6 space-y-4 overflow-y-auto">
					{error && (
						<div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
							<AlertTriangle className="w-4 h-4 flex-shrink-0" />
							{error}
						</div>
					)}

					{/* One-time display of a freshly created token */}
					{created && (
						<div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 space-y-2">
							<p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
								{t("apiTokens.createdOnce", "Copy this token now — it will never be shown again.")}
							</p>
							<div className="flex items-center gap-2">
								<code className="flex-1 text-xs font-mono bg-background border border-border rounded-lg px-3 py-2 break-all select-all">
									{created.token}
								</code>
								<button
									type="button"
									onClick={handleCopy}
									className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium border border-border bg-card hover:bg-accent rounded-lg transition-colors flex-shrink-0"
								>
									{copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
									{copied ? t("common.copied", "Copied") : t("common.copy", "Copy")}
								</button>
							</div>
						</div>
					)}

					{/* Create form */}
					<div className="border border-border rounded-lg p-4 space-y-3">
						<p className="text-sm font-medium text-foreground">{t("apiTokens.create", "Create new token")}</p>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("apiTokens.namePlaceholder", "Token name (e.g. analysis script)")}
							maxLength={255}
							className="w-full h-9 px-3 text-sm bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
						/>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<Select value={scope} onValueChange={(v) => setScope(v as "read" | "full")}>
								<SelectTrigger className="h-9" aria-label={t("apiTokens.scope", "Scope")}>
									<SelectValue placeholder={t("apiTokens.scope", "Scope")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="read">{t("apiTokens.scopeRead", "Read-only (recommended)")}</SelectItem>
									<SelectItem value="full">{t("apiTokens.scopeFull", "Read & write")}</SelectItem>
								</SelectContent>
							</Select>
							<Select value={String(expiresInDays)} onValueChange={(v) => setExpiresInDays(Number(v))}>
								<SelectTrigger className="h-9" aria-label={t("apiTokens.expiry", "Expiry")}>
									<SelectValue placeholder={t("apiTokens.expiry", "Expiry")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="30">{t("apiTokens.expiry30", "Expires in 30 days")}</SelectItem>
									<SelectItem value="90">{t("apiTokens.expiry90", "Expires in 90 days")}</SelectItem>
									<SelectItem value="365">{t("apiTokens.expiry365", "Expires in 1 year")}</SelectItem>
									<SelectItem value="0">{t("apiTokens.expiryNever", "Never expires")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<button
							type="button"
							onClick={handleCreate}
							disabled={!name.trim() || creating}
							className="h-9 px-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
						>
							{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
							{t("apiTokens.generate", "Generate token")}
						</button>
					</div>

					{/* Existing tokens */}
					<div className="space-y-2">
						<p className="text-sm font-medium text-foreground">{t("apiTokens.existing", "Existing tokens")}</p>
						{loading ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
								<Loader2 className="w-4 h-4 animate-spin" />
								{t("common.loading", "Loading…")}
							</div>
						) : tokens.length === 0 ? (
							<p className="text-sm text-muted-foreground py-2">{t("apiTokens.none", "No tokens yet.")}</p>
						) : (
							<ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
								{tokens.map((token) => {
									const status = tokenStatus(token);
									return (
										<li key={token.id} className="flex items-center gap-3 px-3 py-2.5 bg-card">
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="text-sm font-medium text-foreground truncate">{token.name}</span>
													<code className="text-[10px] font-mono text-muted-foreground">{token.token_prefix}…</code>
													<span
														className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
															status === "active"
																? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
																: "bg-muted text-muted-foreground"
														}`}
													>
														{status === "active"
															? t("apiTokens.status.active", "Active")
															: status === "revoked"
																? t("apiTokens.status.revoked", "Revoked")
																: t("apiTokens.status.expired", "Expired")}
													</span>
												</div>
												<p className="text-xs text-muted-foreground">
													{token.scope === "full"
														? t("apiTokens.scopeFullShort", "read & write")
														: t("apiTokens.scopeReadShort", "read-only")}
													{" · "}
													{t("apiTokens.expires", "expires")} {formatDate(token.expires_at)}
													{" · "}
													{t("apiTokens.lastUsed", "last used")} {formatDate(token.last_used_at)}
												</p>
											</div>
											{status === "active" && (
												<button
													type="button"
													onClick={() => handleRevoke(token)}
													className="h-8 px-2.5 inline-flex items-center gap-1 text-xs text-destructive border border-destructive/30 hover:bg-destructive/10 rounded-lg transition-colors flex-shrink-0"
												>
													<ShieldOff className="w-3.5 h-3.5" />
													{t("apiTokens.revoke", "Revoke")}
												</button>
											)}
										</li>
									);
								})}
							</ul>
						)}
					</div>

					<p className="text-xs text-muted-foreground">
						{t(
							"apiTokens.usageHint",
							'Use the token from any app: Authorization: Bearer <token>. Read-only tokens can list models and download results with this user\'s permissions.'
						)}
					</p>
				</div>
			</AlertDialogContent>
		</AlertDialog>
	);
}
