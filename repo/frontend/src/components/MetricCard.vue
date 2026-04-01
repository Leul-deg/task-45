<script setup lang="ts">
defineProps<{
  value: number | string;
  label: string;
  variant?: "default" | "danger" | "warn" | "neutral";
}>();
</script>

<template>
  <article class="card metric" :class="variant ?? 'default'">
    <h2>{{ value }}</h2>
    <p>{{ label }}</p>
  </article>
</template>
