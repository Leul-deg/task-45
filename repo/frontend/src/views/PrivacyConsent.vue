<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { checkServerConsent, defaultRouteForRole, getSession, setPrivacyConsentAccepted, syncConsentToServer } from "../utils/auth";
import { http } from "../utils/http";

const router = useRouter();
const accepted = ref(false);
const error = ref("");
const submitting = ref(false);
const checking = ref(true);

onMounted(async () => {
  try {
    const serverConsented = await checkServerConsent(http);
    if (serverConsented) {
      setPrivacyConsentAccepted(true);
      const session = getSession();
      if (session) {
        await router.push(defaultRouteForRole(session.user.role));
        return;
      }
    }
  } catch {
    // Fall through to manual consent
  } finally {
    checking.value = false;
  }
});

async function submitConsent() {
  if (!accepted.value) {
    error.value = "You must accept tracking consent to continue.";
    return;
  }

  submitting.value = true;
  setPrivacyConsentAccepted(true);
  await syncConsentToServer(http);
  submitting.value = false;

  const session = getSession();
  if (!session) {
    await router.push("/login");
    return;
  }

  await router.push(defaultRouteForRole(session.user.role));
}
</script>

<template>
  <section class="view consent-view">
    <div v-if="checking" class="card consent-card">
      <p class="muted">Verifying consent status...</p>
    </div>
    <div v-else class="card consent-card">
      <p class="eyebrow">Privacy Requirement</p>
      <h1>Tracking Consent</h1>
      <p class="muted">
        We store minimal activity telemetry for security auditing, replay defense, and SLA diagnostics.
        Consent is required before using protected workflows.
      </p>

      <label class="inline-check">
        <input v-model="accepted" type="checkbox" />
        <span>I consent to local security and audit tracking.</span>
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="btn" @click="submitConsent">Continue</button>
    </div>
  </section>
</template>
