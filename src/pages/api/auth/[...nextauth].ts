// src/pages/api/auth/[...nextauth].ts
import NextAuth, {
  NextAuthOptions,
  Profile,
  Session,
  User,
  Account,
} from "next-auth";
import { JWT } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { TokenSet } from "next-auth/core/types";

// --- Module Augmentations -------------------------------------------------
declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      userId?: string;
    };
  }

  interface Profile {
    id: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    locationId?: string;
    companyId?: string;
    userId?: string;
    email?: string;
    error?: string;
  }
}

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

// --- Config & Client -------------------------------------------------------
const prisma = new PrismaClient();
const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

export const authOptions: NextAuthOptions = {
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
              locationId: data.locationId,
              companyId: data.companyId,
              userId: data.userId,
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
          console.log("[userinfo] Fetching user info:", url);

          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Version: "2021-07-28",
            },
          });
          const text = await res.text();

          console.log("[userinfo] Status:", res.status, "Body:", text);
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
          console.log("[userinfo] Parsed JSON:", json);

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
    },
  ],
  callbacks: {
    async jwt({
      token,
      account,
      user,
    }: {
      token: JWT;
      account: Account | null;
      user?: User;
    }) {
      if (account && user) {
        console.log("[jwt] account:", account);
        console.log("[jwt] user:", user);
        console.log("[jwt] ▶ about to upsert user:", {
          id: user.id,
          name: user.name,
          email: user.email,
        });
        try {
          const upserted = await prisma.user.upsert({
            where: { id: user.id },
            create: {
              id: user.id,
              name: user.name!,
              email: user.email!,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              tokenExpiresAt: account.expires_at
                ? new Date(account.expires_at * 1000)
                : undefined,
            },
            update: {
              // ← add name & email here as well:
              name: user.name!,
              email: user.email!,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              tokenExpiresAt: account.expires_at
                ? new Date(account.expires_at * 1000)
                : undefined,
            },
          });
          console.log("[jwt] ✅ upserted user:", upserted);
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error("[jwt] ❌ upsert error:", errorMessage);
        }
        token.sub = user.id;
        token.userId = user.id;
        token.email = user.email ?? undefined;
      }
      return token;
    },

    async session({ session, token }: { session: Session; token: JWT }) {
      console.log("[session] JWT token:", token);
      session.user = {
        ...session.user,
        userId: token.sub,
        email: token.email ?? null,
      };
      console.log("[session] Session object:", session);
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
