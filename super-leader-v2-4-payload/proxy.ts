import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { readTemporaryAccessState } from "@/lib/auth/temporary-access";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

type OrganizationRole = "owner" | "admin" | "hr" | "manager" | "employee";

type RouteRule = {
  prefix: string;
  roles: OrganizationRole[];
};

const dashboardRouteRules: RouteRule[] = [
  { prefix: "/dashboard/acquisition", roles: ["owner", "admin", "hr"] },
  { prefix: "/dashboard/company", roles: ["owner", "admin", "hr"] },
  { prefix: "/dashboard/team", roles: ["owner", "admin", "hr", "manager"] },
  { prefix: "/dashboard/members", roles: ["owner", "admin", "hr", "manager"] },
  { prefix: "/dashboard/sales", roles: ["owner", "admin", "manager", "employee"] },
  { prefix: "/dashboard/collections", roles: ["owner", "admin", "manager", "employee"] },
  { prefix: "/dashboard/crm", roles: ["owner", "admin", "manager", "employee"] },
  { prefix: "/dashboard/feedback-automation", roles: ["owner", "admin", "manager"] },
  { prefix: "/dashboard/reports", roles: ["owner", "admin", "hr", "manager"] },
];

function roleCanOpenPath(pathname: string, role: OrganizationRole): boolean {
  const rule = dashboardRouteRules.find(
    (candidate) =>
      pathname === candidate.prefix || pathname.startsWith(`${candidate.prefix}/`),
  );
  return !rule || rule.roles.includes(role);
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  let config: ReturnType<typeof getSupabasePublicConfig>;

  try {
    config = getSupabasePublicConfig();
  } catch (error) {
    console.error("Supabase proxy configuration error", error);
    return response;
  }

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    console.warn("Supabase session refresh warning", error.message);
  }

  const pathname = request.nextUrl.pathname;
  const isPasswordChangePage = pathname.startsWith(
    "/change-password-required",
  );
  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/update-password") ||
    isPasswordChangePage;

  if (isProtected && !data?.claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (data?.claims) {
    const claims = data.claims as Record<string, unknown>;
    const userId = typeof claims.sub === "string" ? claims.sub : "";
    let securitySource = claims.user_metadata;

    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("must_change_password,temporary_password_expires_at")
        .eq("id", userId)
        .maybeSingle();

      if (profile) {
        securitySource = profile;
      }
    }

    const temporaryAccess = readTemporaryAccessState(
      securitySource,
      new Date().getTime(),
    );

    if (temporaryAccess.mustChangePassword) {
      if (temporaryAccess.expired) {
        if (!pathname.startsWith("/auth/temporary-access-expired")) {
          const url = request.nextUrl.clone();
          url.pathname = "/auth/temporary-access-expired";
          url.search = "";
          return NextResponse.redirect(url);
        }
      } else if (!isPasswordChangePage) {
        const url = request.nextUrl.clone();
        url.pathname = "/change-password-required";
        url.search = "";
        return NextResponse.redirect(url);
      }
    } else if (isPasswordChangePage) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard/my-day";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (userId && pathname.startsWith("/dashboard")) {
      const { data: membership, error: membershipError } = await supabase
        .from("organization_members")
        .select("role,is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle<{ role: OrganizationRole; is_active: boolean }>();

      if (membershipError) {
        console.error("Dashboard authorization lookup failed", membershipError);
        if (pathname !== "/dashboard") {
          const url = request.nextUrl.clone();
          url.pathname = "/dashboard";
          url.search = "";
          url.searchParams.set("error", "authorization-unavailable");
          return NextResponse.redirect(url);
        }
      } else if (!membership) {
        const allowedWithoutOrganization = pathname === "/dashboard";
        if (!allowedWithoutOrganization) {
          const url = request.nextUrl.clone();
          url.pathname = "/dashboard";
          url.search = "";
          return NextResponse.redirect(url);
        }
      } else if (!roleCanOpenPath(pathname, membership.role)) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        url.search = "";
        url.searchParams.set("error", "access-denied");
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
