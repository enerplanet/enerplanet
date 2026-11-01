import React, { useEffect } from "react";
import {
	LoginForm as LibLoginForm,
	RegisterForm as LibRegisterForm,
	ForgotPasswordForm as LibForgotPasswordForm,
	type LoginFormProps,
	type RegisterFormProps,
	type ForgotPasswordFormProps,
} from "@spatialhub/auth";
import { config } from "@/configuration/app";
import { auth } from "@/configuration/auth";
import { useAuthStore } from "@/store/auth-store";
import { ensureCSRFToken } from "@/utils/csrf";
import { useSearchParams } from "react-router-dom";
import { CheckCircle, Loader2 } from "lucide-react";

const SSO_QUERY_PARAMETER = "sso";

// Builds the auth-service SSO entrypoint (server-side OIDC → session cookie).
// The RENvolveIT toolbox links here; the callback lands the user on return_to.
function ssoLoginUrl(): string {
	const base = config.api.baseUrl || "/api";
	let returnTo = "/app/model-dashboard";
	try {
		if (auth.sso.redirectUri) {
			returnTo = new URL(auth.sso.redirectUri).pathname || returnTo;
		}
	} catch {
		// keep default
	}
	const params = new URLSearchParams();
	if (auth.sso.idpHint) params.set("idp_hint", auth.sso.idpHint);
	params.set("return_to", returnTo);
	return `${base}/auth/sso/login?${params.toString()}`;
}

const EnerPlanETLogo = (
	<div className="flex items-center justify-center mb-1">
		<img src="/brand/enerplanet-lockup-green-outline.svg" alt="EnerPlanET" className="h-12 w-auto dark:hidden" />
		<img src="/brand/enerplanet-lockup-green-dark-outline.svg" alt="EnerPlanET" className="hidden h-12 w-auto dark:block" />
	</div>
);

const EnerPlanETSidePanel = (
	<div className="absolute inset-0">
		<img
			src="/images/login-bg.png"
			alt=""
			aria-hidden
			className="absolute inset-0 h-full w-full object-cover"
		/>
		<div className="absolute inset-0 bg-gradient-to-br from-slate-900/92 via-slate-900/82 to-slate-800/70" />
		<div className="relative flex h-full flex-col p-10 xl:p-14 text-white">
			<div className="my-auto max-w-lg">
				<h2 className="text-3xl xl:text-4xl font-extrabold leading-tight tracking-tight text-balance">
					Energy Planning for the <span className="text-[#3DD68C]">E</span>nergy{" "}
					<span className="text-[#3DD68C]">T</span>ransition
				</h2>
				<p className="mt-4 text-base text-white/80 leading-relaxed text-balance">
					Model and optimise heat and power for local communities.
				</p>
			</div>
		</div>
	</div>
);

const SsoLoginForm: React.FC = () => {
	useEffect(() => {
		document.title = "Sign in";
		globalThis.location.replace(ssoLoginUrl());
	}, []);

	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-6">
			<div className="flex max-w-md flex-col items-center gap-4 text-center">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
				<p className="text-sm text-muted-foreground">
					Redirecting to single sign-on…
				</p>
			</div>
		</div>
	);
};

const PasswordLoginForm: React.FC<Partial<LoginFormProps>> = (props) => {
	const { init } = useAuthStore();
	const [searchParams] = useSearchParams();
	const isVerified = searchParams.get("verified") === "true";

	return (
		<>
			{isVerified && (
				<div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-500">
					<div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 shadow-lg text-sm text-emerald-700 dark:text-emerald-300">
						<CheckCircle className="w-4 h-4 flex-shrink-0" />
						<span>Email verified successfully! You can now log in.</span>
					</div>
				</div>
			)}
			<LibLoginForm
				onDocumentTitle={(title: string) => {
					document.title = title;
				}}
				onAuthInit={async (data) => {
					await init({
						user: data.user as Parameters<typeof init>[0]["user"],
						sessionTimeout: data.sessionTimeout,
					});
				}}
				onEnsureCSRF={async () => {
					await ensureCSRFToken();
				}}
				apiBaseUrl={config.api.baseUrl || "/api"}
				appName={EnerPlanETLogo}
				backgroundImageUrl="/images/login-bg.svg"
				storageNamespace="enerplanet"
				layout="split"
				sideContent={EnerPlanETSidePanel}
				{...props}
			/>
		</>
	);
};

export const LoginForm: React.FC<Partial<LoginFormProps>> = (props) => {
	return <LoginFormRouter {...props} />;
};

// SSO only when explicitly requested via ?sso=renvolveit (the toolbox link);
// direct visitors get EnerPlanET's own email/password login.
const LoginFormRouter: React.FC<Partial<LoginFormProps>> = (props) => {
	const [searchParams] = useSearchParams();
	const ssoRequested = auth.sso.enabled && searchParams.has(SSO_QUERY_PARAMETER);
	return ssoRequested ? <SsoLoginForm /> : <PasswordLoginForm {...props} />;
};

export const RegisterForm: React.FC<Partial<RegisterFormProps>> = (props) => {
	return (
		<LibRegisterForm
			onDocumentTitle={(title: string) => {
				document.title = title;
			}}
			apiBaseUrl={config.api.baseUrl || "/api"}
			appName={EnerPlanETLogo}
			backgroundImageUrl="/images/login-bg.svg"
			layout="split"
			sideContent={EnerPlanETSidePanel}
			{...props}
		/>
	);
};

export const ForgotPasswordForm: React.FC<Partial<ForgotPasswordFormProps>> = (props) => {
	return (
		<LibForgotPasswordForm
			onDocumentTitle={(title: string) => {
				document.title = title;
			}}
			apiBaseUrl={config.api.baseUrl || "/api"}
			appName={EnerPlanETLogo}
			backgroundImageUrl="/images/login-bg.svg"
			layout="split"
			sideContent={EnerPlanETSidePanel}
			{...props}
		/>
	);
};
