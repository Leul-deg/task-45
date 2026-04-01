<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { defaultRouteForRole, isPrivacyConsentAccepted, saveSession } from "../utils/auth";
import { http } from "../utils/http";

const router = useRouter();
const route = useRoute();

const username = ref("");
const password = ref("");
const loading = ref(false);
const errorMessage = ref("");

const canSubmit = computed(() => username.value.trim().length > 0 && password.value.length > 0);

async function handleLogin() {
  if (!canSubmit.value || loading.value) {
    return;
  }

  loading.value = true;
  errorMessage.value = "";

  try {
    const response = await http.post("/auth/login", {
      username: username.value.trim(),
      password: password.value,
    });

    const payload = response.data as {
      access_token: string;
      expires_in: number;
      csrf_token: string;
      user: { id: number; username: string; role: "Administrator" | "Reporter" | "Dispatcher" | "Safety Manager" | "Auditor" };
    };

    saveSession({
      accessToken: payload.access_token,
      csrfToken: payload.csrf_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
      user: payload.user,
    });

    if (!isPrivacyConsentAccepted()) {
      await router.push("/privacy-consent");
      return;
    }

    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : null;
    await router.push(redirect || defaultRouteForRole(payload.user.role));
  } catch (error: unknown) {
    const message =
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: { data?: { error?: string } } }).response?.data?.error === "string"
        ? (error as { response: { data: { error: string } } }).response.data.error
        : "Unable to sign in. Check your credentials and try again.";

    errorMessage.value = message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="view auth-view">
    <div class="card auth-card">
      <p class="eyebrow">Secure Access</p>
      <h1>Incident Command Portal</h1>
      <p class="muted">Use your local account to continue. Session token expires in 15 minutes.</p>

      <form class="stack" @submit.prevent="handleLogin">
        <label class="field">
          <span>Username</span>
          <input v-model="username" autocomplete="username" required />
        </label>

        <label class="field">
          <span>Password</span>
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>

        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

        <button class="btn" type="submit" :disabled="!canSubmit || loading">
          {{ loading ? "Signing in..." : "Sign in" }}
        </button>
      </form>
    </div>
  </section>
</template>
