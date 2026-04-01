<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { http } from "../utils/http";

const typeOptions = ref<string[]>(["Injury", "Fire", "Spill", "Equipment Failure", "Security", "Near Miss"]);
const siteOptions = ref<string[]>([]);
const settingsLoading = ref(false);
const settingsError = ref("");

const form = ref({
  site: "",
  type: typeOptions.value[0],
  description: "",
  time: new Date().toISOString(),
  phone: "",
  medicalNotes: "",
});

const selectedFiles = ref<File[]>([]);
const uploading = ref(false);
const error = ref("");
const success = ref("");

onMounted(() => {
  void loadSettings();
});

function updateAutoTime() {
  form.value.time = new Date().toISOString();
}

function onFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);

  if (files.length > 5) {
    error.value = "You can upload up to 5 images.";
    selectedFiles.value = [];
    return;
  }

  selectedFiles.value = files;
}

function maskValue(value: string) {
  if (!value) {
    return "-";
  }

  const tail = value.slice(-4);
  const head = "*".repeat(Math.max(0, value.length - 4));
  return `${head}${tail}`;
}

const maskedPhone = computed(() => maskValue(form.value.phone.replace(/\D/g, "")));
const maskedNotes = computed(() => maskValue(form.value.medicalNotes));

const canSubmit = computed(() => form.value.description.trim().length >= 10 && Boolean(form.value.site) && Boolean(form.value.type));

async function loadSettings() {
  settingsLoading.value = true;
  settingsError.value = "";
  try {
    const response = await http.get("/settings/config");
    const types = (response.data.incident_types || []) as string[];
    if (types.length > 0) {
      typeOptions.value = types;
    }
    const sites = (response.data.facility_sites || []) as string[];
    if (sites.length > 0) {
      siteOptions.value = sites;
    }
  } catch (requestError: unknown) {
    const maybeResponse = requestError as { response?: { data?: { error?: string } } };
    settingsError.value = maybeResponse.response?.data?.error || "Unable to load settings. Using defaults.";
  } finally {
    settingsLoading.value = false;
  }
}

async function submitIncident() {
  if (!canSubmit.value || uploading.value) {
    return;
  }

  error.value = "";
  success.value = "";
  uploading.value = true;

  try {
    const body = new FormData();
    body.append("site", form.value.site);
    body.append("type", form.value.type);
    body.append("description", form.value.description);
    body.append("time", form.value.time);

    if (form.value.phone.trim()) {
      body.append("phone", form.value.phone.trim());
    }
    if (form.value.medicalNotes.trim()) {
      body.append("medical_notes", form.value.medicalNotes.trim());
    }

    for (const file of selectedFiles.value) {
      if (file.size > 10 * 1024 * 1024) {
        throw new Error(`File ${file.name} exceeds 10MB limit.`);
      }

      body.append("images", file);
    }

    const response = await http.post("/incidents", body, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    success.value = `Incident #${response.data.id} submitted in ${response.data.processing_ms} ms.`;
    form.value.description = "";
    form.value.phone = "";
    form.value.medicalNotes = "";
    selectedFiles.value = [];
    updateAutoTime();
  } catch (requestError: unknown) {
    const maybeResponse = requestError as { response?: { data?: { error?: string } } };
    error.value = maybeResponse.response?.data?.error || (requestError as Error).message || "Unable to submit incident.";
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <section class="view">
    <header class="view-header">
      <div>
        <p class="eyebrow">Reporter Workspace</p>
        <h1>File a New Incident</h1>
      </div>
      <button class="btn ghost" @click="updateAutoTime">Refresh Time</button>
    </header>

    <div class="grid two-col">
      <form class="card stack" @submit.prevent="submitIncident">
        <label class="field">
          <span>Site</span>
          <select v-if="siteOptions.length > 0" v-model="form.site" :disabled="settingsLoading">
            <option value="" disabled>Select a site</option>
            <option v-for="site in siteOptions" :key="site" :value="site">{{ site }}</option>
          </select>
          <input v-else v-model="form.site" :disabled="settingsLoading" :placeholder="settingsLoading ? 'Loading sites...' : 'Enter facility site name'" />
        </label>

        <label class="field">
          <span>Incident Type</span>
          <select v-model="form.type" :disabled="settingsLoading">
            <option v-if="settingsLoading" value="">Loading types...</option>
            <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
          </select>
        </label>

        <label class="field">
          <span>Automated Time</span>
          <input :value="new Date(form.time).toLocaleString()" disabled />
        </label>

        <label class="field">
          <span>Description</span>
          <textarea v-model="form.description" rows="5" placeholder="Describe what happened, immediate risks, and current conditions." />
        </label>

        <label class="field">
          <span>Phone (optional)</span>
          <input v-model="form.phone" placeholder="Used for secure callback" />
        </label>

        <label class="field">
          <span>Medical Notes (optional)</span>
          <textarea v-model="form.medicalNotes" rows="3" placeholder="Sensitive notes are encrypted at rest." />
        </label>

        <label class="field">
          <span>Evidence Images (max 5, 10MB each)</span>
          <input type="file" accept="image/*" multiple @change="onFileSelect" />
        </label>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="settingsError" class="error">{{ settingsError }}</p>
        <p v-if="success" class="success">{{ success }}</p>

        <button class="btn" type="submit" :disabled="!canSubmit || uploading">
          {{ uploading ? "Submitting..." : "Submit Incident" }}
        </button>
      </form>

      <aside class="card stack">
        <h2>Privacy Preview</h2>
        <p class="muted">Displayed PII is masked in the UI before response rendering.</p>

        <div class="summary-row">
          <strong>Masked Phone</strong>
          <span>{{ maskedPhone }}</span>
        </div>

        <div class="summary-row">
          <strong>Masked Medical Notes</strong>
          <span>{{ maskedNotes }}</span>
        </div>

        <div class="summary-row">
          <strong>Files Selected</strong>
          <span>{{ selectedFiles.length }}</span>
        </div>

        <ul class="file-list">
          <li v-for="file in selectedFiles" :key="`${file.name}-${file.size}`">
            {{ file.name }}
          </li>
        </ul>
      </aside>
    </div>
  </section>
</template>
