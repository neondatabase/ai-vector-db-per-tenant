import { GoogleStrategy } from "remix-auth-google";
import {
	selectUserSchema,
	users,
	vectorDatabases,
	type User,
} from "./db/schema";
import { createDbClient } from "./db";
import { generateId } from "./db/utils/generate-id";
import { getErrorMessage } from "./utils/get-error-message";
import { neon } from "@neondatabase/serverless";
import { createNeonApiClient } from "./vector-db";
import type { Env } from "./env";

import { createCookieSessionStorage } from "@remix-run/cloudflare";
import { Authenticator } from "remix-auth";
import type { SessionStorage } from "@remix-run/cloudflare";
import { z } from "zod";
import type { TypedSessionStorage } from "remix-utils/typed-session";

const SessionSchema = z.object({
	user: selectUserSchema.optional(),
	strategy: z.string().optional(),
	"oauth2:state": z.string().uuid().optional(),
	"auth:error": z.object({ message: z.string() }).optional(),
});

export type Session = z.infer<typeof SessionSchema>;

export interface IAuthService {
	readonly authenticator: Authenticator<User>;
	readonly sessionStorage: SessionStorage;
}

export class AuthService implements IAuthService {
	#sessionStorage: SessionStorage<typeof SessionSchema>;
	#authenticator: Authenticator<User>;

	constructor(env: Env, hostname: string) {
		const sessionStorage = createCookieSessionStorage({
			cookie: {
				name: "__session",
				sameSite: "lax",
				path: "/",
				httpOnly: true, // for security reasons, make this cookie http only
				secrets: [env.SESSION_SECRET], // replace this with an actual secret
				secure: process.env.NODE_ENV === "production", // enable this in prod only
			},
		});

		this.#sessionStorage = sessionStorage;
		this.#authenticator = new Authenticator<User>(
			this.#sessionStorage as unknown as SessionStorage,
			{
				throwOnError: true,
			},
		);

		this.#authenticator.use(
			new GoogleStrategy(
				{
					clientID: env.GOOGLE_CLIENT_ID,
					clientSecret: env.GOOGLE_CLIENT_SECRET,
					callbackURL: env.GOOGLE_CALLBACK_URL,
				},
				async ({ profile }) => {
					const email = profile.emails[0].value;

					try {
						const db = createDbClient(env.DATABASE_URL);

						const user = await db.query.users.findFirst({
							where: (users, { eq }) => eq(users.email, email),
						});

						if (!user) {
							const neonApiClient = createNeonApiClient(env.NEON_API_KEY);

							const { data, error } = await neonApiClient.POST("/projects", {
								body: {
									project: {},
								},
							});

							if (error) {
								throw new Error(`Failed to create Neon project, ${error}`);
							}

							const vectorDbId = data?.project.id;

							const vectorDbConnectionUri =
								data.connection_uris[0]?.connection_uri;

							const sql = neon(vectorDbConnectionUri);

							await sql`CREATE EXTENSION IF NOT EXISTS vector;`;

							await sql.transaction([
								sql`CREATE EXTENSION IF NOT EXISTS vector;`,
								sql`CREATE TABLE IF NOT EXISTS "embeddings" (
									"id" serial PRIMARY KEY NOT NULL,
									"content" text NOT NULL,
									"metadata" jsonb NOT NULL,
									"embedding" vector(1536),
									"created_at" timestamp with time zone DEFAULT now(),
									"updated_at" timestamp with time zone DEFAULT now()
								)`,
								sql`CREATE INDEX IF NOT EXISTS "embedding_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops)`,
							]);

							const newUser = await db
								.insert(users)
								.values({
									email,
									name: profile.displayName,
									avatarUrl: profile.photos[0].value,
									userId: generateId({ object: "user" }),
								})
								.onConflictDoNothing()
								.returning();

							await db.insert(vectorDatabases).values({
								vectorDbId,
								userId: newUser[0].id,
							});

							return newUser[0];
						}

						return user;
					} catch (error) {
						console.error("User creation error:", error);
						throw new Error(getErrorMessage(error));
					}
				},
			),
		);
	}

	get authenticator() {
		return this.#authenticator;
	}

	get sessionStorage() {
		return this.#sessionStorage;
	}
}
