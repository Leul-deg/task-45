<script setup lang="ts">
type IncidentStatus = "New" | "Acknowledged" | "In Progress" | "Escalated" | "Closed";

const statuses: IncidentStatus[] = ["New", "Acknowledged", "In Progress", "Escalated", "Closed"];

const model = defineModel<{
  status: IncidentStatus;
  triageNotes: string;
  collaborators: string;
}>({ required: true });

defineProps<{
  disabled: boolean;
}>();

const emit = defineEmits<{
  apply: [];
}>();
</script>

<template>
  <div class="inline-edit">
    <select v-model="model.status">
      <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
    </select>
    <input v-model="model.collaborators" placeholder="Collaborator IDs: 12,41" />
    <input v-model="model.triageNotes" placeholder="Triage notes" />
    <button class="btn tiny" :disabled="disabled" @click="emit('apply')">
      {{ disabled ? "Saving..." : "Apply" }}
    </button>
  </div>
</template>
