import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ResourcesView from "../Resources.vue";

vi.mock("../../utils/http", () => ({
  http: {
    get: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

import { http } from "../../utils/http";

function makeResource(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Fire Extinguisher SOP",
    category: "Fire Safety",
    description: "Standard operating procedure for fire extinguishers",
    url: "/docs/fire-sop.pdf",
    tags: ["fire", "extinguisher"],
    created_at: "2026-01-01T00:00:00Z",
    relevance_score: 5,
    ...overrides,
  };
}

describe("Resources.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the search form with keyword and category fields", () => {
    const wrapper = mount(ResourcesView);
    expect(wrapper.find("h1").text()).toContain("Safety Resources");
    expect(wrapper.find("input[placeholder*='PPE']").exists()).toBe(true);
    expect(wrapper.find("select").exists()).toBe(true);
  });

  it("calls API and renders results on search", async () => {
    const mockGet = vi.mocked(http.get);
    mockGet.mockResolvedValueOnce({
      data: { results: [makeResource(), makeResource({ id: 2, title: "PPE Guide" })] },
    } as never);

    const wrapper = mount(ResourcesView);
    await wrapper.find("input[placeholder*='PPE']").setValue("fire");
    await wrapper.findAll("button").find((b) => b.text() === "Search")!.trigger("click");
    await flushPromises();

    expect(mockGet).toHaveBeenCalledWith("/search/resources", expect.objectContaining({
      params: expect.objectContaining({ q: "fire" }),
    }));
    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.text()).toContain("Fire Extinguisher SOP");
    expect(wrapper.text()).toContain("PPE Guide");
  });

  it("shows empty state when no results", async () => {
    const mockGet = vi.mocked(http.get);
    mockGet.mockResolvedValueOnce({ data: { results: [] } } as never);

    const wrapper = mount(ResourcesView);
    await wrapper.findAll("button").find((b) => b.text() === "Search")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("No resources match your search");
  });

  it("shows error message on API failure", async () => {
    const mockGet = vi.mocked(http.get);
    mockGet.mockRejectedValueOnce({ response: { data: { error: "Server error" } } });

    const wrapper = mount(ResourcesView);
    await wrapper.findAll("button").find((b) => b.text() === "Search")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Server error");
  });

  it("resets filters when reset button clicked", async () => {
    const wrapper = mount(ResourcesView);
    const input = wrapper.find("input[placeholder*='PPE']");
    await input.setValue("fire");

    await wrapper.findAll("button").find((b) => b.text() === "Reset")!.trigger("click");

    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("renders tags, category, and link columns", async () => {
    const mockGet = vi.mocked(http.get);
    mockGet.mockResolvedValueOnce({
      data: { results: [makeResource()] },
    } as never);

    const wrapper = mount(ResourcesView);
    await wrapper.findAll("button").find((b) => b.text() === "Search")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Fire Safety");
    expect(wrapper.text()).toContain("fire, extinguisher");
    expect(wrapper.find("a[href='/docs/fire-sop.pdf']").exists()).toBe(true);
  });

  it("passes tags and sort params to API", async () => {
    const mockGet = vi.mocked(http.get);
    mockGet.mockResolvedValueOnce({ data: { results: [] } } as never);

    const wrapper = mount(ResourcesView);
    const selects = wrapper.findAll("select");
    const sortSelect = selects[selects.length - 1];
    await sortSelect.setValue("title");

    await wrapper.findAll("button").find((b) => b.text() === "Search")!.trigger("click");
    await flushPromises();

    expect(mockGet).toHaveBeenCalledWith("/search/resources", expect.objectContaining({
      params: expect.objectContaining({ sort: "title" }),
    }));
  });

  it("includes relevance score column", async () => {
    const mockGet = vi.mocked(http.get);
    mockGet.mockResolvedValueOnce({
      data: { results: [makeResource({ relevance_score: 7 })] },
    } as never);

    const wrapper = mount(ResourcesView);
    await wrapper.findAll("button").find((b) => b.text() === "Search")!.trigger("click");
    await flushPromises();

    expect(wrapper.find("th").text()).toBeDefined();
    expect(wrapper.text()).toContain("Relevance");
    expect(wrapper.text()).toContain("7");
  });
});
