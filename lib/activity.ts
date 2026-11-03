import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";

export async function logActivity(
  profile: Profile,
  action: string,
  details?: string
) {
  const supabase = await createClient();
  await supabase.from("activity_log").insert({
    organization_id: profile.organization_id,
    user_id: profile.id,
    username: profile.username,
    role: profile.role,
    action,
    details: details ?? null,
  });
}
