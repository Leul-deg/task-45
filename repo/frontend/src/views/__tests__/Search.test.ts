import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SearchView from "../Search.vue";

vi.mock("../../utils/http", () => ({
  http: {
    get: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock("../../utils/csv", () => ({
  downloadCsv: vi.fn(),
}));

vi.mock("../../utils/auth", () => ({
  getSession: vi.fn(() => ({
    accessToken: "tok",
    expiresAt: Date.now() + 900000,
    csrfToken: "csrf",
    user: { id: 1, username: "admin", role: "Administrator" },
  })),
  hasValidSession: vi.fn(() => true),
  clearSession: vi.fn(),
  saveSession: vi.fn(),
}));

import { http } from "../../utils/http";
import { downloadCsv } from "../../utils/csv";

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    site: "Warehouse A",
    type: "Spill",
    status: "New",
    rating: 3,
    cost: 150,
    time: "2026-03-30T10:00:00Z",
    created_at: "2026-03-30T10:00:00Z",
    popularity: 5,
    recent_activity: null,
    relevance_score: 8,
    ...overrides,
  };
}

describe("Search.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the search page header and filter form", () => {
    const wrapper = mount(SearchView);
    expect(wrapper.text()).toContain("Incident Search");
    expect(wrapper.text()).toContain("Data Exploration");
    expect(wrapper.find("input[placeholder*='Keyword']").exists()).toBe(true);
  });

  it("renders all filter fields", () => {
    const wrapper = mount(SearchView);
    expect(wrapper.find("input[placeholder*='Keyword']").exists()).toBe(true);
    expect(wrapper.find("input[placeholder*='Warehouse']").exists()).toBe(true);
    expect(wrapper.find("input[placeholder*='chemical']").exists()).toBe(true);
    expect(wrapper.find("input[type='date']").exists()).toBe(true);
    expect(wrapper.findAll("select").length).toBeGreaterThanOrEqual(2);
  });

  it("calls search API when Search button is clicked", async () => {
    vi.mocked(http.get).mockResolvedValueOnce({
      data: { results: [makeResult()] },
    });

    const wrapper = mount(SearchView);
    const keywordInput = wrapper.find("input[placeholder*='Keyword']");
    await keywordInput.setValue("fire");

    const searchBtn = wrapper.findAll("button").find((b) => b.text().includes("Search"));
    await searchBtn!.trigger("click");
    await flushPromises();

    expect(http.get).toHaveBeenCalledWith("/search/incidents", expect.objectContaining({
      params: expect.objectContaining({ q: "fire", limit: 100 }),
    }));
  });

  it("displays search results in a table", async () => {
    const results = [
      makeResult({ id: 10, site: "Lab B", type: "Fire", status: "Closed" }),
      makeResult({ id: 11, site: "Dock", type: "Near Miss", status: "New" }),
    ];
    vi.mocked(http.get).mockResolvedValueOnce({ data: { results } });

    const wrapper = mount(SearchView);
    const searchBtn = wrapper.findAll("button").find((b) => b.text().includes("Search"));
    await searchBtn!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("#10");
    expect(wrapper.text()).toContain("Lab B");
    expect(wrapper.text()).toContain("#11");
    expect(wrapper.text()).toContain("Results (2)");
  });

  it('shows "No incidents match" when results are empty', async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: { results: [] } });

    const wrapper = mount(SearchView);
    const searchBtn = wrapper.findAll("button").find((b) => b.text().includes("Search"));
    await searchBtn!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("No incidents match your search criteria.");
  });

  it("shows error message on search failure", async () => {
    vi.mocked(http.get).mockRejectedValueOnce({
      response: { data: { error: "Search failed" } },
    });

    const wrapper = mount(SearchView);
    const searchBtn = wrapper.findAll("button").find((b) => b.text().includes("Search"));
    await searchBtn!.trigger("click");
    await flushPromises();

    expect(wrapper.find(".error").text()).toBe("Search failed");
  });

  it("resets all filters when Reset button is clicked", async () => {
    const wrapper = mount(SearchView);
    const keywordInput = wrapper.find("input[placeholder*='Keyword']");
    await keywordInput.setValue("fire");

    const resetBtn = wrapper.findAll("button").find((b) => b.text().includes("Reset"));
    await resetBtn!.trigger("click");

    expect((keywordInput.element as HTMLInputElement).value).toBe("");
  });

  it("calls downloadCsv when Export CSV is clicked", async () => {
    const results = [makeResult({ id: 7, site: "HQ" })];
    vi.mocked(http.get).mockResolvedValueOnce({ data: { results } });

    const wrapper = mount(SearchView);
    const searchBtn = wrapper.findAll("button").find((b) => b.text().includes("Search"));
    await searchBtn!.trigger("click");
    await flushPromises();

    const exportBtn = wrapper.findAll("button").find((b) => b.text().includes("Export CSV"));
    await exportBtn!.trigger("click");

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadCsv).mock.calls[0][1]).toEqual(expect.arrayContaining(["Incident ID", "Site"]));
  });

  it("disables Export CSV button when no results", () => {
    const wrapper = mount(SearchView);
    const exportBtn = wrapper.findAll("button").find((b) => b.text().includes("Export CSV"));
    expect((exportBtn!.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Searching... text on button while loading", async () => {
    vi.mocked(http.get).mockImplementation(() => new Promise(() => {}));

    const wrapper = mount(SearchView);
    const searchBtn = wrapper.findAll("button").find((b) => b.text().includes("Search"));
    await searchBtn!.trigger("click");
    await wrapper.vm.$nextTick();

    expect(searchBtn!.text()).toBe("Searching...");
  });
});
