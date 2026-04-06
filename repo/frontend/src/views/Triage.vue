<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";

import MetricCard from "../components/MetricCard.vue";
import SlaPill from "../components/SlaPill.vue";
import InlineTriageEdit from "../components/InlineTriageEdit.vue";
import { http } from "../utils/http";

type IncidentStatus = "New" | "Acknowledged" | "In Progress" | "Escalated" | "Closed";

interface IncidentRecord {
  id: number;
  site: string;
  type: string;
  status: IncidentStatus;
  rating: number | null;
  cost: number | null;
  created_at: string;
  recent_activity: string | null;
}

const ackTargetMinutes = ref(15);
const closeTargetHours = ref(72);

const loading = ref(false);
const submitting = ref(false);
const error = ref("");
const incidents = ref<IncidentRecord[]>([]);
const updates = reactive<Record<number, { status: IncidentStatus; triageNotes: string; collaborators: string }>>({});

function ensureUpdateState(incident: IncidentRecord) {
  if (!updates[incident.id]) {
    updates[incident.id] = {
      status: incident.status,
      triageNotes: "",
      collaborators: "",
    };
  }
}

const BIZ_START = 8;
const BIZ_END = 18;

function isBusinessDay(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function businessMinutesBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let total = 0;
  const cursor = new Date(start);

  while (cursor < end) {
    if (!isBusinessDay(cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(BIZ_START, 0, 0, 0);
      continue;
    }
    const dayStart = new Date(cursor);
    if (dayStart.getHours() < BIZ_START) dayStart.setHours(BIZ_START, 0, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(BIZ_END, 0, 0, 0);

    if (dayStart >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(BIZ_START, 0, 0, 0);
      continue;
    }
    const sliceEnd = end < dayEnd ? end : dayEnd;
    if (sliceEnd > dayStart) total += (sliceEnd.getTime() - dayStart.getTime()) / 60000;

    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(BIZ_START, 0, 0, 0);
  }
  return Math.floor(total);
}

function elapsedBusinessMinutes(value: string): number {
  return businessMinutesBetween(new Date(value), new Date());
}

function ackAlertClass(incident: IncidentRecord): string {
  if (incident.status !== "New") {
    return "ok";
  }

  const elapsed = elapsedBusinessMinutes(incident.created_at);
  if (elapsed >= ackTargetMinutes.value) {
    return "danger";
  }
  if (elapsed >= ackTargetMinutes.value - 5) {
    return "warn";
  }
  return "ok";
}

function closeAlertClass(incident: IncidentRecord): string {
  if (incident.status === "Closed" || incident.status === "Escalated") {
    return "ok";
  }

  const elapsedHours = elapsedBusinessMinutes(incident.created_at) / 60;
  if (elapsedHours >= closeTargetHours.value) {
    return "danger";
  }
  if (elapsedHours >= closeTargetHours.value - 6) {
    return "warn";
  }
  return "ok";
}

const slaSummary = computed(() => {
  const ackRisk = incidents.value.filter((item) => ackAlertClass(item) !== "ok").length;
  const closeRisk = incidents.value.filter((item) => closeAlertClass(item) !== "ok").length;
  const escalated = incidents.value.filter((item) => item.status === "Escalated").length;

  return {
    total: incidents.value.length,
    ackRisk,
    closeRisk,
    escalated,
  };
});

async function loadSlaConfig() {
  try {
    const response = await http.get("/settings/config");
    const sla = response.data.sla_defaults;
    if (sla) {
      ackTargetMinutes.value = Number(sla.ack_minutes) || 15;
      closeTargetHours.value = Number(sla.close_hours) || 72;
    }
  } catch {
    // Fall back to defaults silently
  }
}

async function loadIncidents() {
  loading.value = true;
  error.value = "";

  try {
    await loadSlaConfig();

    const response = await http.get("/search/incidents", {
      params: {
        sort: "recent_activity",
        limit: 100,
      },
    });

    const results = (response.data.results || []) as IncidentRecord[];
    incidents.value = results;
    for (const incident of results) {
      ensureUpdateState(incident);
    }
  } catch (requestError: unknown) {
    const maybeResponse = requestError as { response?: { data?: { error?: string } } };
    error.value = maybeResponse.response?.data?.error || "Unable to load incidents.";
  } finally {
    loading.value = false;
  }
}

async function applyStatusUpdate(incident: IncidentRecord) {
  const state = updates[incident.id];
  if (!state || submitting.value) {
    return;
  }

  submitting.value = true;
  error.value = "";

  const collaborators = state.collaborators
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);

  try {
    await http.patch(`/incidents/${incident.id}/status`, {
      status: state.status,
      triage_notes: state.triageNotes,
      collaborators,
    });

    await loadIncidents();
  } catch (requestError: unknown) {
    const maybeResponse = requestError as { response?: { data?: { error?: string } } };
    error.value = maybeResponse.response?.data?.error || "Unable to update incident status.";
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void loadIncidents();
});
</script>

<template>
  <section class="view">
    <header class="view-header">
      <div>
        <p class="eyebrow">Dispatcher Dashboard</p>
        <h1>Live Triage Queue</h1>
      </div>
      <button class="btn ghost" :disabled="loading" @click="loadIncidents">{{ loading ? "Refreshing..." : "Refresh" }}</button>
    </header>

    <section class="grid four-col alerts">
      <MetricCard :value="slaSummary.total" label="Total Open Records" />
      <MetricCard :value="slaSummary.ackRisk" label="Ack SLA at Risk" variant="danger" />
      <MetricCard :value="slaSummary.closeRisk" label="Close SLA at Risk" variant="warn" />
      <MetricCard :value="slaSummary.escalated" label="Escalated" variant="neutral" />
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="loading" class="card">
      <p class="muted">Loading incidents...</p>
    </div>
    <div v-else-if="incidents.length === 0" class="card">
      <p class="muted">No incidents found.</p>
    </div>
    <div v-else class="card table-card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Site</th>
            <th>Type</th>
            <th>Status</th>
            <th>Ack SLA</th>
            <th>Close SLA</th>
            <th>Triage</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="incident in incidents" :key="incident.id">
            <td>#{{ incident.id }}</td>
            <td>{{ incident.site }}</td>
            <td>{{ incident.type }}</td>
            <td>{{ incident.status }}</td>
            <td>
              <SlaPill
                :label="`${Math.max(ackTargetMinutes - elapsedBusinessMinutes(incident.created_at), 0)}m left`"
                :severity="ackAlertClass(incident) as 'ok' | 'warn' | 'danger'"
              />
            </td>
            <td>
              <SlaPill
                :label="incident.status === 'Escalated' ? 'Exempt' : `${Math.max(closeTargetHours - elapsedBusinessMinutes(incident.created_at) / 60, 0).toFixed(1)}h left`"
                :severity="closeAlertClass(incident) as 'ok' | 'warn' | 'danger'"
              />
            </td>
            <td>
              <InlineTriageEdit
                v-model="updates[incident.id]"
                :disabled="submitting"
                @apply="applyStatusUpdate(incident)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
