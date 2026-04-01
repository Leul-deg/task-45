<script setup lang="ts">
defineProps<{
  label: string;
  severity: "ok" | "warn" | "danger";
}>();
</script>

<template>
  <span class="pill" :class="severity">{{ label }}</span>
</template>
