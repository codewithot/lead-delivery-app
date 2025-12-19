// src/pages/api/auth/[...nextauth].ts
import NextAuth, {
  NextAuthOptions,
  Profile,
  Account,
} from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createLogger } from "@/lib/secureLogger";
import { PrismaClient } from "@prisma/client";
import { TokenSet } from "next-auth/core/types";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
const logger = createLogger('NextAuth');


// --- Type Definitions ------------------------------------------------------
interface GHLTokenResponse extends TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  userId: string;
  locationId?: string;
  companyId?: string;
}

interface GHLUserInfo {
  name?: string;
  email?: string;
}

interface ExtendedProfile extends Profile {
  locationId?: string;
  companyId?: string;
}

// ← CHANGE 1: Add extended Account type to access custom fields
interface ExtendedAccount extends Account {
  locationId?: string;
  companyId?: string;
}

// --- Config & Client -------------------------------------------------------
const prisma = new PrismaClient();
const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma), // Add PrismaAdapter
  providers: [
    {
      id: "gh",
      name: "GH",
      type: "oauth",
      version: "2.0",
      authorization: {
        url: "https://marketplace.gohighlevel.com/oauth/chooselocation",
        params: {
          scope:
            "contacts.write contacts.readonly locations/customValues.readonly locations/customValues.write locations/customFields.readonly locations/customFields.write locations.readonly opportunities.readonly opportunities.write calendars.readonly calendars.write users.readonly users.write oauth.write oauth.readonly",
          response_type: "code",
        },
      },
      token: {
        url: TOKEN_URL,
        params: { grant_type: "authorization_code" },
        async request(context) {
          const { params, provider } = context;
          const code = params.code as string;
          const redirectUri = provider.callbackUrl!;
          const rawCfg = provider.token!;
          const tokenUrl = typeof rawCfg === "string" ? rawCfg : rawCfg.url;
          const body = new URLSearchParams({
            client_id: process.env.GHL_CLIENT_ID!,
            client_secret: process.env.GHL_CLIENT_SECRET!,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            user_type: "Location",
          });
          const res = await fetch(tokenUrl!, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(JSON.stringify(data));
          const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
          return {
            tokens: {
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              expires_in: data.expires_in,
              expires_at: expiresAt,
              token_type: data.token_type,
              scope: data.scope,
              locationId: data.location_id || data.locationId,
              companyId: data.company_id || data.companyId,
              userId: data.user_id || data.userId,
            },
          };
        },
      },
      userinfo: {
        async request(context): Promise<Profile> {
          // Access tokens from context and cast to our extended type
          const tokens = context.tokens as unknown as GHLTokenResponse;
          const accessToken = tokens.access_token;
          const userId = tokens.userId;

          if (!accessToken || !userId) {
            console.error("[userinfo] Missing credentials:", {
              accessToken,
              userId,
            });
            throw new Error("Missing credentials");
          }

          const url = `https://services.leadconnectorhq.com/users/${userId}`;
          logger.debug("[userinfo] Fetching user info", { userId: tokens.userId });

          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Version: "2021-07-28",
            },
          });
          const text = await res.text();

          logger.debug("[userinfo] Response received", {
            status: res.status,
            hasBody: !!text,
            bodyLength: text?.length || 0
          });

          if (!res.ok) {
            throw new Error(`Bad response: ${res.status}`);
          }

          let json: GHLUserInfo;
          try {
            json = JSON.parse(text);
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            console.error("[userinfo] JSON.parse failed:", text, errorMessage);
            throw err;
          }

          logger.debug("[userinfo] User info parsed", {
            userId: tokens.userId,
            hasName: !!json.name,
            hasEmail: !!json.email
          });

          // Return profile with additional metadata
          const profile: ExtendedProfile = {
            id: userId,
            name: (json.name as string) ?? `User ${userId}`,
            email: (json.email as string) ?? undefined,
            image: undefined,
            locationId: tokens.locationId,
            companyId: tokens.companyId,
          };
          return profile;
        },
      },
      clientId: process.env.GHL_CLIENT_ID!,
      clientSecret: process.env.GHL_CLIENT_SECRET!,
      profile(profile, tokens) {
        // Cast tokens to access custom properties
        const ghlTokens = tokens as unknown as GHLTokenResponse;
        const extendedProfile = profile as ExtendedProfile;

        return {
          id: profile.id,
          name: profile.name,
          email: profile.email ?? undefined,
          locationId: extendedProfile.locationId ?? ghlTokens.locationId,
          companyId: extendedProfile.companyId ?? ghlTokens.companyId,
        };
      },
      allowDangerousEmailAccountLinking: true,
    },
    // Credentials Provider for Email/Password Login
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.password) {
          throw new Error("User not found or password not set");
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);

        if (!isValid) {
          throw new Error("Invalid password");
        }

        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (user) {
        logger.info("[jwt] User login detected", { userId: user.id, email: user.email });
        token.sub = user.id;
        token.userId = user.id;
        token.email = user.email ?? undefined;
        token.role = (user as { role?: string }).role || 'USER';
        token.locationId = (user as { locationId?: string }).locationId ?? undefined;
        token.companyId = (user as { companyId?: string }).companyId ?? undefined;

        if (account) {
          const extendedAccount = account as ExtendedAccount;
          logger.info("[jwt] OAuth account detected", {
            provider: account.provider,
            locationId: extendedAccount.locationId,
            companyId: extendedAccount.companyId
          });

          if (extendedAccount.locationId) token.locationId = extendedAccount.locationId;
          if (extendedAccount.companyId) token.companyId = extendedAccount.companyId;

          // Store tokens in database using update
          try {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                accessToken: account.access_token,
                refreshToken: account.refresh_token,
                tokenExpiresAt: account.expires_at
                  ? new Date(account.expires_at * 1000)
                  : undefined,
                locationId: token.locationId,
                companyId: token.companyId,
              },
            });
            logger.info("[jwt] User tokens and IDs updated in DB");
          } catch (e) {
            logger.error("[jwt] Token update error:", e);
          }
        } else {
          logger.info("[jwt] Credential login or existing session", {
            hasLocationId: !!token.locationId
          });
        }
      }
      return token;
    },

    async session({ session, token }) {
      logger.debug("[session] Callback triggered", {
        userId: token.userId,
        locationId: token.locationId
      });
      if (session.user) {
        session.user.userId = token.userId;
        session.user.email = token.email ?? null;
        session.user.role = token.role;
        session.user.locationId = token.locationId;
        session.user.companyId = token.companyId;
      }
      return session;
    },

    async redirect({ url, baseUrl }: { url: string; baseUrl: string }) {
      if (url.startsWith("/")) return baseUrl + url;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        // Invalid URL, return baseUrl
      }
      return baseUrl;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7,
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: { signIn: "/auth/signin", error: "/auth/error" },
  debug: process.env.NODE_ENV === "development",
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
