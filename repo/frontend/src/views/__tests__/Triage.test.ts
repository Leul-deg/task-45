import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TriageView from "../Triage.vue";

vi.mock("../../utils/http", () => ({
  http: {
    get: vi.fn(),
    patch: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock("../../utils/auth", () => ({
  getSession: vi.fn(() => ({
    accessToken: "tok",
    expiresAt: Date.now() + 900000,
    csrfToken: "csrf",
    user: { id: 2, username: "dispatcher1", role: "Dispatcher" },
  })),
  hasValidSession: vi.fn(() => true),
  clearSession: vi.fn(),
  saveSession: vi.fn(),
}));

import { http } from "../../utils/http";

const settingsResponse = {
  data: { sla_defaults: { ack_minutes: 15, close_hours: 72 } },
};

function makeIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    site: "Warehouse A",
    type: "Fire",
    status: "New",
    rating: null,
    cost: null,
    created_at: new Date().toISOString(),
    recent_activity: null,
    ...overrides,
  };
}

function mockGetCalls(incidentsData: { results: unknown[] }) {
  vi.mocked(http.get).mockImplementation((url: string) => {
    if (url === "/settings/config") {
      return Promise.resolve(settingsResponse);
    }
    return Promise.resolve({ data: incidentsData });
  });
}

describe("Triage.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the dispatcher dashboard header", async () => {
    mockGetCalls({ results: [] });
    const wrapper = mount(TriageView);
    await flushPromises();
    expect(wrapper.text()).toContain("Live Triage Queue");
    expect(wrapper.text()).toContain("Dispatcher Dashboard");
  });

  it("loads SLA config and displays incidents on mount", async () => {
    const incidents = [
      makeIncident({ id: 1, site: "Dock A", type: "Spill", status: "New" }),
      makeIncident({ id: 2, site: "Lab", type: "Fire", status: "Acknowledged" }),
    ];
    mockGetCalls({ results: incidents });

    const wrapper = mount(TriageView);
    await flushPromises();

    expect(http.get).toHaveBeenCalledWith("/settings/config");
    expect(http.get).toHaveBeenCalledWith("/search/incidents", {
      params: { sort: "recent_activity", limit: 100 },
    });
    expect(wrapper.text()).toContain("Dock A");
    expect(wrapper.text()).toContain("Lab");
    expect(wrapper.text()).toContain("#1");
    expect(wrapper.text()).toContain("#2");
  });

  it("uses configurable SLA values from settings", async () => {
    const old = new Date(Date.now() - 20 * 60000).toISOString();
    const incidents = [makeIncident({ id: 1, status: "New", created_at: old })];

    vi.mocked(http.get).mockImplementation((url: string) => {
      if (url === "/settings/config") {
        return Promise.resolve({ data: { sla_defaults: { ack_minutes: 30, close_hours: 48 } } });
      }
      return Promise.resolve({ data: { results: incidents } });
    });

    const wrapper = mount(TriageView);
    await flushPromises();

    const pills = wrapper.findAll(".pill");
    expect(pills.length).toBeGreaterThanOrEqual(2);
    // With 30 min ack target and 20 min elapsed, should be "ok" (not at risk yet)
    expect(pills[0].classes()).toContain("ok");
  });

  it("shows SLA summary metrics", async () => {
    const old = new Date(Date.now() - 20 * 60000).toISOString();
    const incidents = [
      makeIncident({ id: 1, status: "New", created_at: old }),
      makeIncident({ id: 2, status: "Escalated", created_at: old }),
    ];
    mockGetCalls({ results: incidents });

    const wrapper = mount(TriageView);
    await flushPromises();

    expect(wrapper.text()).toContain("Total Open Records");
    expect(wrapper.text()).toContain("Ack SLA at Risk");
    expect(wrapper.text()).toContain("Escalated");
  });

  it('shows "No incidents found." when list is empty', async () => {
    mockGetCalls({ results: [] });

    const wrapper = mount(TriageView);
    await flushPromises();

    expect(wrapper.text()).toContain("No incidents found.");
  });

  it("shows error message on load failure", async () => {
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (url === "/settings/config") {
        return Promise.resolve(settingsResponse);
      }
      return Promise.reject({
        response: { data: { error: "Server error" } },
      });
    });

    const wrapper = mount(TriageView);
    await flushPromises();

    expect(wrapper.find(".error").text()).toBe("Server error");
  });

  it("shows loading state while fetching", async () => {
    vi.mocked(http.get).mockImplementation(() => new Promise(() => {}));

    const wrapper = mount(TriageView);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Loading incidents...");
    expect(wrapper.find("button").text()).toBe("Refreshing...");
  });

  it("calls PATCH when Apply is clicked on an incident", async () => {
    const incidents = [makeIncident({ id: 5, status: "New" })];
    mockGetCalls({ results: incidents });
    vi.mocked(http.patch).mockResolvedValueOnce({ data: { id: 5, status: "Acknowledged" } });

    const wrapper = mount(TriageView);
    await flushPromises();

    const select = wrapper.find(".inline-edit select");
    await select.setValue("Acknowledged");

    const notesInput = wrapper.findAll(".inline-edit input")[1];
    await notesInput.setValue("Checked on site");

    const applyBtn = wrapper.find(".inline-edit .btn");
    await applyBtn.trigger("click");
    await flushPromises();

    expect(http.patch).toHaveBeenCalledWith("/incidents/5/status", {
      status: "Acknowledged",
      triage_notes: "Checked on site",
      collaborators: [],
    });
  });

  it("shows error when status update fails", async () => {
    const incidents = [makeIncident({ id: 3, status: "New" })];
    mockGetCalls({ results: incidents });
    vi.mocked(http.patch).mockRejectedValueOnce({
      response: { data: { error: "Cannot transition" } },
    });

    const wrapper = mount(TriageView);
    await flushPromises();

    const applyBtn = wrapper.find(".inline-edit .btn");
    await applyBtn.trigger("click");
    await flushPromises();

    expect(wrapper.find(".error").text()).toBe("Cannot transition");
  });

  it("renders SLA pill classes correctly based on time", async () => {
    const recentTime = new Date().toISOString();
    const incidents = [makeIncident({ id: 1, status: "New", created_at: recentTime })];
    mockGetCalls({ results: incidents });

    const wrapper = mount(TriageView);
    await flushPromises();

    const pills = wrapper.findAll(".pill");
    expect(pills.length).toBeGreaterThanOrEqual(2);
    expect(pills[0].classes()).toContain("ok");
  });
});
