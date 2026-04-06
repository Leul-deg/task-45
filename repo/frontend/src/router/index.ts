import { createRouter, createWebHistory } from "vue-router";

import LoginView from "../views/Login.vue";
import PrivacyConsentView from "../views/PrivacyConsent.vue";
import AdminView from "../views/Admin.vue";
import ReportIncidentView from "../views/ReportIncident.vue";
import ResourcesView from "../views/Resources.vue";
import SearchView from "../views/Search.vue";
import TriageView from "../views/Triage.vue";
import { defaultRouteForRole, getSession, hasValidSession, isPrivacyConsentAccepted, type UserRole } from "../utils/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/login",
    },
    {
      path: "/login",
      name: "login",
      component: LoginView,
      meta: { public: true },
    },
    {
      path: "/privacy-consent",
      name: "privacy-consent",
      component: PrivacyConsentView,
      meta: { requiresAuth: true },
    },
    {
      path: "/report",
      name: "report-incident",
      component: ReportIncidentView,
      meta: {
        requiresAuth: true,
        roles: ["Reporter"] satisfies UserRole[],
      },
    },
    {
      path: "/triage",
      name: "triage",
      component: TriageView,
      meta: {
        requiresAuth: true,
        roles: ["Dispatcher", "Safety Manager", "Administrator"] satisfies UserRole[],
      },
    },
    {
      path: "/search",
      name: "search",
      component: SearchView,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/resources",
      name: "resources",
      component: ResourcesView,
      meta: {
        requiresAuth: true,
      },
    },
    {
      path: "/admin",
      name: "admin",
      component: AdminView,
      meta: {
        requiresAuth: true,
        roles: ["Safety Manager", "Auditor", "Administrator"] satisfies UserRole[],
      },
    },
  ],
});

router.beforeEach((to) => {
  const requiresAuth = Boolean(to.meta.requiresAuth);
  const isPublic = Boolean(to.meta.public);

  if (!isPublic && requiresAuth && !hasValidSession()) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }

  const session = getSession();

  if (to.path === "/login" && session && hasValidSession()) {
    return { path: defaultRouteForRole(session.user.role) };
  }

  if (requiresAuth) {
    if (!session || !hasValidSession()) {
      return { path: "/login", query: { redirect: to.fullPath } };
    }

    if (!isPrivacyConsentAccepted() && to.path !== "/privacy-consent") {
      return { path: "/privacy-consent" };
    }

    const allowedRoles = (to.meta.roles as UserRole[] | undefined) || [];
    if (allowedRoles.length > 0 && !allowedRoles.includes(session.user.role)) {
      return { path: defaultRouteForRole(session.user.role) };
    }
  }

  return true;
});

export default router;
