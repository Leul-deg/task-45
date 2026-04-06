<script setup lang="ts">
import { reactive, ref } from "vue";

import FilterField from "../components/FilterField.vue";
import { http } from "../utils/http";

interface ResourceItem {
  id: number;
  title: string;
  category: string;
  description: string;
  url: string | null;
  tags: string[];
  created_at: string;
  relevance_score: number;
}

const filters = reactive({
  q: "",
  category: "",
  tags: "",
  title_contains: "",
  description_contains: "",
  has_url: "",
  date_from: "",
  date_to: "",
  sort: "recent",
});

const loading = ref(false);
const error = ref("");
const results = ref<ResourceItem[]>([]);
const hasSearched = ref(false);

async function runSearch() {
  loading.value = true;
  error.value = "";

  try {
    const response = await http.get("/search/resources", {
      params: {
        q: filters.q || undefined,
        category: filters.category || undefined,
        tags: filters.tags || undefined,
        title_contains: filters.title_contains || undefined,
        description_contains: filters.description_contains || undefined,
        has_url: filters.has_url || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        sort: filters.sort || undefined,
        limit: 100,
      },
    });

    results.value = (response.data.results || []) as ResourceItem[];
    hasSearched.value = true;
  } catch (requestError: unknown) {
    const maybeResponse = requestError as { response?: { data?: { error?: string } } };
    error.value = maybeResponse.response?.data?.error || "Unable to search resources.";
    hasSearched.value = false;
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  hasSearched.value = false;
  filters.q = "";
  filters.category = "";
  filters.tags = "";
  filters.title_contains = "";
  filters.description_contains = "";
  filters.has_url = "";
  filters.date_from = "";
  filters.date_to = "";
  filters.sort = "recent";
}
</script>

<template>
  <section class="view">
    <header class="view-header">
      <div>
        <p class="eyebrow">Safety Knowledge Base</p>
        <h1>Safety Resources</h1>
      </div>
      <div class="toolbar-actions">
        <button class="btn ghost" @click="resetFilters">Reset</button>
        <button class="btn" :disabled="loading" @click="runSearch">{{ loading ? "Searching..." : "Search" }}</button>
      </div>
    </header>

    <div class="card grid filter-grid">
      <FilterField label="Keyword (synonyms + pinyin)">
        <input v-model="filters.q" placeholder="PPE, fire, chemical, 火灾..." />
      </FilterField>
      <FilterField label="Category">
        <select v-model="filters.category">
          <option value="">All</option>
          <option>Fire Safety</option>
          <option>Hazardous Materials</option>
          <option>Personal Protective Equipment</option>
          <option>Confined Space</option>
          <option>Machine Safety</option>
          <option>Investigation</option>
          <option>Emergency Response</option>
          <option>Ergonomics</option>
        </select>
      </FilterField>
      <FilterField label="Tags">
        <input v-model="filters.tags" placeholder="LOTO,PPE,chemical" />
      </FilterField>
      <FilterField label="Title Contains">
        <input v-model="filters.title_contains" placeholder="procedure" />
      </FilterField>
      <FilterField label="Description Contains">
        <input v-model="filters.description_contains" placeholder="cleanup" />
      </FilterField>
      <FilterField label="Has URL">
        <select v-model="filters.has_url">
          <option value="">All</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </FilterField>
      <FilterField label="Date From">
        <input v-model="filters.date_from" type="date" />
      </FilterField>
      <FilterField label="Date To">
        <input v-model="filters.date_to" type="date" />
      </FilterField>
      <FilterField label="Sort">
        <select v-model="filters.sort">
          <option value="relevance">Relevance</option>
          <option value="recent">Recent</option>
          <option value="title">Title</option>
          <option value="category">Category</option>
        </select>
      </FilterField>
    </div>

    <div class="card table-card">
      <div class="table-head">
        <h2>Results ({{ results.length }})</h2>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="hasSearched && results.length === 0" class="muted">No resources match your search.</p>

      <table v-if="results.length > 0">
        <thead>
          <tr>
            <th>Title</th>
            <th>Category</th>
            <th>Description</th>
            <th>Tags</th>
            <th>Relevance</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in results" :key="item.id">
            <td><strong>{{ item.title }}</strong></td>
            <td>{{ item.category }}</td>
            <td>{{ item.description.length > 120 ? item.description.slice(0, 120) + "..." : item.description }}</td>
            <td>{{ (item.tags || []).join(", ") }}</td>
            <td>{{ item.relevance_score }}</td>
            <td><a v-if="item.url" :href="item.url" target="_blank" rel="noopener">View</a></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
