import type { DefaultSession } from "next-auth";
import type { Team } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string; team?: Team | null; isAdmin: boolean };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    team?: Team | null;
    isAdmin?: boolean;
  }
}
