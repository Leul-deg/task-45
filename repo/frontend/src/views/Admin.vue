<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Bar, Doughnut } from "vue-chartjs";
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, Legend, LinearScale, Tooltip } from "chart.js";

import MetricCard from "../components/MetricCard.vue";
import { downloadCsv } from "../utils/csv";
import { getSession } from "../utils/auth";
import { http } from "../utils/http";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

interface CountMetric {
  status?: string;
  action?: string;
  user_id?: number | null;
  count: number;
}

const loading = ref(false);
const error = ref("");

const dateFrom = ref("");
const dateTo = ref("");

const statusMetrics = ref<CountMetric[]>([]);
const moderationMetrics = ref<CountMetric[]>([]);
const userActivityMetrics = ref<CountMetric[]>([]);
const slaAtRisk = ref({ ack_at_risk: 0, close_at_risk: 0, escalated: 0, total_open: 0 });

const configState = reactive({
  ack_minutes: 15,
  close_hours: 72,
  incident_types_input: "Injury,Fire,Spill,Equipment Failure,Security,Near Miss",
  sla_rules_json: "[]",
  severity_rules_json: "[]",
  facility_sites_input: "",
  message: "",
  saving: false,
});

const canManageSettings = computed(() => getSession()?.user.role === "Safety Manager");

const statusChartData = computed(() => ({
  labels: statusMetrics.value.map((item) => item.status || "Unknown"),
  datasets: [
    {
      label: "Incidents",
      data: statusMetrics.value.map((item) => item.count),
      backgroundColor: ["#2f7f99", "#59a15a", "#e0b32d", "#d86b63", "#6080c2"],
    },
  ],
}));

const moderationChartData = computed(() => ({
  labels: moderationMetrics.value.map((item) => item.action || "Unknown"),
  datasets: [
    {
      label: "Actions",
      data: moderationMetrics.value.map((item) => item.count),
      backgroundColor: "#4a8bb2",
    },
  ],
}));

const userActivityChartData = computed(() => ({
  labels: userActivityMetrics.value.map((item) => `User ${item.user_id ?? "N/A"}`),
  datasets: [
    {
      label: "Audit Log Events (7d)",
      data: userActivityMetrics.value.map((item) => item.count),
      backgroundColor: "#7d9f4f",
    },
  ],
}));

async function loadMetrics() {
  loading.value = true;
  error.value = "";

  try {
    const metricsResponse = await http.get("/admin/metrics", {
      params: {
        date_from: dateFrom.value || undefined,
        date_to: dateTo.value || undefined,
      },
    });

    statusMetrics.value = (metricsResponse.data.incidents_by_status || []) as CountMetric[];
    moderationMetrics.value = (metricsResponse.data.moderation_actions || []) as CountMetric[];
    userActivityMetrics.value = (metricsResponse.data.user_activity_logs || []) as CountMetric[];
    if (metricsResponse.data.sla_at_risk) {
      slaAtRisk.value = metricsResponse.data.sla_at_risk;
    }

    const settingsResponse = await http.get("/settings/config");
    const sla = settingsResponse.data.sla_defaults || {};
    const incidentTypes = (settingsResponse.data.incident_types || []) as string[];
    const slaRules = settingsResponse.data.sla_rules || [];
    const severityRules = settingsResponse.data.severity_rules || [];
    const facilitySites = (settingsResponse.data.facility_sites || []) as string[];

    configState.ack_minutes = Number(sla.ack_minutes || 15);
    configState.close_hours = Number(sla.close_hours || 72);
    configState.incident_types_input = incidentTypes.join(",");
    configState.sla_rules_json = JSON.stringify(slaRules, null, 2);
    configState.severity_rules_json = JSON.stringify(severityRules, null, 2);
    configState.facility_sites_input = facilitySites.join(",");
  } catch (requestError: unknown) {
    const maybeResponse = requestError as { response?: { data?: { error?: string } } };
    error.value = maybeResponse.response?.data?.error || "Unable to load dashboard data.";
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  if (!canManageSettings.value || configState.saving) {
    return;
  }

  configState.saving = true;
  configState.message = "";
  error.value = "";

  try {
    await http.patch("/settings/sla", {
      ack_minutes: configState.ack_minutes,
      close_hours: configState.close_hours,
    });

    const incidentTypes = configState.incident_types_input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    await http.patch("/settings/incident-types", {
      incident_types: incidentTypes,
    });

    let parsedRules: unknown = [];
    try {
      parsedRules = JSON.parse(configState.sla_rules_json || "[]");
    } catch {
      throw new Error("Custom SLA rules must be valid JSON.");
    }

    await http.patch("/settings/sla-rules", {
      rules: parsedRules,
    });

    let parsedSeverityRules: unknown = [];
    try {
      parsedSeverityRules = JSON.parse(configState.severity_rules_json || "[]");
    } catch {
      throw new Error("Severity rules must be valid JSON.");
    }

    await http.patch("/settings/severity-rules", {
      rules: parsedSeverityRules,
    });

    const facilitySites = configState.facility_sites_input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (facilitySites.length > 0) {
      await http.patch("/settings/facility-sites", {
        sites: facilitySites,
      });
    }

    configState.message = "Settings saved successfully.";
  } catch (requestError: unknown) {
    const maybeResponse = requestError as { response?: { data?: { error?: string } } };
    error.value =
      maybeResponse.response?.data?.error ||
      (requestError instanceof Error ? requestError.message : "Unable to save settings.");
  } finally {
    configState.saving = false;
  }
}

function exportMetricsCsv() {
  const rows: Array<Array<unknown>> = [];

  for (const row of statusMetrics.value) {
    rows.push(["incidents_by_status", row.status || "Unknown", row.count]);
  }

  for (const row of moderationMetrics.value) {
    rows.push(["moderation_actions", row.action || "Unknown", row.count]);
  }

  for (const row of userActivityMetrics.value) {
    rows.push(["user_activity_logs", row.user_id ?? "N/A", row.count]);
  }

  downloadCsv(
    `metrics-export-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`,
    ["metric_group", "dimension", "count"],
    rows,
  );
}

onMounted(() => {
  void loadMetrics();
});
</script>

<template>
  <section class="view">
    <header class="view-header">
      <div>
        <p class="eyebrow">Admin and Auditor Analytics</p>
        <h1>Operations Intelligence</h1>
      </div>
      <div class="toolbar-actions">
        <label class="field compact">
          <span>From</span>
          <input v-model="dateFrom" type="date" />
        </label>
        <label class="field compact">
          <span>To</span>
          <input v-model="dateTo" type="date" />
        </label>
        <button class="btn ghost" :disabled="loading" @click="loadMetrics">{{ loading ? "Refreshing..." : "Refresh" }}</button>
        <button class="btn" @click="exportMetricsCsv">CSV Export</button>
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="grid four-col alerts">
      <MetricCard :value="slaAtRisk.total_open" label="Total Open Incidents" />
      <MetricCard :value="slaAtRisk.ack_at_risk" label="Ack SLA at Risk" variant="danger" />
      <MetricCard :value="slaAtRisk.close_at_risk" label="Close SLA at Risk" variant="warn" />
      <MetricCard :value="slaAtRisk.escalated" label="Escalated" variant="neutral" />
    </section>

    <section class="grid two-col">
      <article class="card stack">
        <h2>Incident Distribution</h2>
        <Doughnut :data="statusChartData" />
      </article>
      <article class="card stack">
        <h2>Moderation and Workflow Actions</h2>
        <Bar :data="moderationChartData" />
      </article>
    </section>

    <section class="card stack">
      <h2>User Activity Logs (Audit)</h2>
      <Bar :data="userActivityChartData" />
    </section>

    <section class="card stack">
      <h2>Safety Manager Configuration</h2>
      <p class="muted">Configure incident types and SLA rules for routing and escalation.</p>

      <div v-if="canManageSettings" class="grid two-col">
        <label class="field">
          <span>Acknowledgement SLA (minutes)</span>
          <input v-model.number="configState.ack_minutes" type="number" min="1" max="240" />
        </label>

        <label class="field">
          <span>Closure SLA (hours)</span>
          <input v-model.number="configState.close_hours" type="number" min="1" max="720" />
        </label>
      </div>

      <label class="field" :class="{ disabled: !canManageSettings }">
        <span>Incident Types (comma-separated)</span>
        <input v-model="configState.incident_types_input" :disabled="!canManageSettings" />
      </label>

      <label class="field" :class="{ disabled: !canManageSettings }">
        <span>Custom SLA Rules JSON</span>
        <textarea v-model="configState.sla_rules_json" rows="5" :disabled="!canManageSettings" />
      </label>

      <label class="field" :class="{ disabled: !canManageSettings }">
        <span>Severity Rules JSON</span>
        <textarea v-model="configState.severity_rules_json" rows="5" :disabled="!canManageSettings" placeholder='[{"incident_type":"Injury","severity":"high","auto_escalate":true,"escalate_after_hours":24}]' />
      </label>

      <label class="field" :class="{ disabled: !canManageSettings }">
        <span>Facility Sites (comma-separated)</span>
        <input v-model="configState.facility_sites_input" :disabled="!canManageSettings" placeholder="Main Campus,Warehouse A,Lab Building" />
      </label>

      <div class="toolbar-actions">
        <button class="btn" :disabled="!canManageSettings || configState.saving" @click="saveSettings">
          {{ configState.saving ? "Saving..." : "Save Configuration" }}
        </button>
        <p v-if="configState.message" class="success">{{ configState.message }}</p>
      </div>

      <p v-if="!canManageSettings" class="muted">
        You can view configuration snapshots. Only Safety Managers can modify settings.
      </p>
    </section>
  </section>
</template>
