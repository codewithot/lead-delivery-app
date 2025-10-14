// src/pages/api/auth/[...nextauth].ts
import NextAuth, { NextAuthOptions, Profile } from "next-auth";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

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
        async request({ tokens }: { tokens: any }): Promise<Profile> {
          const accessToken = tokens.access_token as string;
          const userId = tokens.userId as string;
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

          let json: any;
          try {
            json = JSON.parse(text);
          } catch (err) {
            console.error("[userinfo] JSON.parse failed:", text);
            throw err;
          }
          console.log("[userinfo] Parsed JSON:", json);

          // Explicitly cast to Profile so TS knows the shape matches
          const profile: Profile = {
            id: userId,
            name: (json.name as string) ?? `User ${userId}`,
            email: (json.email as string) ?? undefined,
            image: undefined,
          };
          return profile;
        },
      },
      clientId: process.env.GHL_CLIENT_ID!,
      clientSecret: process.env.GHL_CLIENT_SECRET!,
      profile(profile: any, tokens: any) {
        return {
          id: profile.id,
          name: profile.name,
          email: profile.email ?? undefined,
          locationId: tokens.locationId,
          companyId: tokens.companyId,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account, user }) {
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
          console.error("[jwt] ❌ upsert error:", e);
        }
        token.sub = user.id;
        token.userId = user.id;
        token.email = user.email ?? undefined;
      }
      const encoded = await encode({
        token,
        secret: process.env.NEXTAUTH_SECRET!,
      });
      return token;
    },

    async session({ session, token }) {
      console.log("[session] JWT token:", token);
      session.user = {
        ...session.user,
        userId: token.sub,
        email: token.email ?? null,
      };
      console.log("[session] Session object:", session);
      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return baseUrl + url;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {}
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
