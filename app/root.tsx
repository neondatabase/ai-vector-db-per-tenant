import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
} from "@remix-run/react";
import "./styles/globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { json, type LoaderFunctionArgs } from "@remix-run/cloudflare";

import { Navbar } from "./components/layout/navbar";
import type { User } from "./lib/db/schema";
import { GenericErrorBoundary } from "./components/misc/error-boundary";

const queryClient = new QueryClient();

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	try {
		const user = await context.auth.authenticator.isAuthenticated(request);
		return json({ user });
	} catch (error) {
		console.error(error);
		return json({ user: null });
	}
};

export function Layout({ children }: { children: React.ReactNode }) {
	const data = useLoaderData<typeof loader>();
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<QueryClientProvider client={queryClient}>
				<Navbar user={data.user as User | null} />
				<body className="bg-[#111111] text-[#b4b4b4]">
					{children}
					<ScrollRestoration />
					<Scripts />
				</body>
			</QueryClientProvider>
		</html>
	);
}

function Document({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body className="bg-muted-app text-muted-base transition-colors">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return (
		<Document>
			<Outlet />
		</Document>
	);
}

export function ErrorBoundary() {
	return (
		<Document>
			<GenericErrorBoundary />
		</Document>
	);
}
