<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";

import { clearSession, getSession, isPrivacyConsentAccepted } from "./utils/auth";
import { http } from "./utils/http";

const router = useRouter();
const route = useRoute();

const session = computed(() => {
  void route.fullPath;
  return getSession();
});
const role = computed(() => session.value?.user.role || "Guest");
const canViewReporter = computed(() => role.value === "Reporter");
const canViewDispatcher = computed(() => ["Dispatcher", "Safety Manager", "Administrator"].includes(role.value));
const canViewSearch = computed(() => session.value !== null);
const canViewAdmin = computed(() => ["Safety Manager", "Auditor", "Administrator"].includes(role.value));
const consented = computed(() => {
  void route.fullPath;
  return isPrivacyConsentAccepted();
});

async function signOut() {
  try {
    await http.post("/auth/logout");
  } catch {
    // Sign-out must complete even if the API call fails
  }
  clearSession();
  await router.push("/login");
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">SafetyOps</p>
        <strong>Incident Control Center</strong>
      </div>
      <nav class="nav-links">
        <RouterLink v-if="canViewReporter" to="/report">Reporter</RouterLink>
        <RouterLink v-if="canViewDispatcher" to="/triage">Dispatcher</RouterLink>
        <RouterLink v-if="canViewSearch" to="/search">Search</RouterLink>
        <RouterLink v-if="canViewAdmin" to="/admin">Admin</RouterLink>
      </nav>
      <div class="identity">
        <small>{{ role }}</small>
        <small>{{ consented ? "Tracking consented" : "Consent pending" }}</small>
        <button class="btn tiny" @click="signOut">Sign out</button>
      </div>
    </header>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
