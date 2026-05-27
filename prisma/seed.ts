import { PrismaClient, type Team } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function seedTeam(): Team | undefined {
  const raw = process.env.SEED_USER_TEAM?.trim();
  if (raw === "on_shore" || raw === "off_shore") return raw;
  return undefined;
}

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@handoff.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "changeme";
  const hash = await bcrypt.hash(password, 12);
  const team = seedTeam();
  await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash: hash, name: "Admin", team, isAdmin: true },
    update: {
      passwordHash: hash,
      isAdmin: true,
      ...(team !== undefined ? { team } : {}),
    },
  });

  const defaults = [
    { id: "ws_fe_production", name: "FE Production", sortOrder: 0 },
    { id: "ws_oms_dev", name: "OMS DEV", sortOrder: 1 },
    { id: "ws_testing", name: "Testing", sortOrder: 2 },
  ];
  for (const w of defaults) {
    await prisma.workspace.upsert({
      where: { id: w.id },
      create: w,
      update: { name: w.name, sortOrder: w.sortOrder },
    });
  }

  console.log(`Seeded user ${email} (admin; set SEED_ADMIN_PASSWORD in production) and default workspaces`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
