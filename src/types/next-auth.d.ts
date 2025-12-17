
import { DefaultSession, DefaultUser } from "next-auth";


declare module "next-auth" {
    interface Session {
        user: {
            userId?: string;
            role?: string;
            accessToken?: string;
        } & DefaultSession["user"];
    }

    interface User extends DefaultUser {
        role?: string;
    }

    interface Profile {
        id: string;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        userId?: string;
        role?: string;
        accessToken?: string;
        locationId?: string;
        companyId?: string;
    }
}
