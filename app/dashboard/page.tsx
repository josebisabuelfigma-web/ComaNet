import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { homeForRole } from "@/lib/permissions";

export default async function DashboardIndexPage() {
  const profile = await requireProfile();
  redirect(homeForRole(profile.role));
}
