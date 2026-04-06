import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AdminView from "../Admin.vue";

vi.mock("../../utils/http", () => ({
  http: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
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
    user: { id: 1, username: "safety_mgr", role: "Safety Manager" },
  })),
  hasValidSession: vi.fn(() => true),
  clearSession: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock("vue-chartjs", () => ({
  Doughnut: { template: "<canvas />" },
  Bar: { template: "<canvas />" },
}));

vi.mock("chart.js", () => ({
  Chart: { register: vi.fn() },
  ArcElement: {},
  BarElement: {},
  CategoryScale: {},
  Legend: {},
  LinearScale: {},
  Tooltip: {},
}));

import { http } from "../../utils/http";
import { downloadCsv } from "../../utils/csv";

const metricsResponse = {
  incidents_by_status: [
    { status: "New", count: 5 },
    { status: "Closed", count: 3 },
  ],
  moderation_actions: [{ action: "STATUS_UPDATED", count: 12 }],
  user_activity_logs: [{ user_id: 1, count: 40 }],
  sla_at_risk: { ack_at_risk: 2, close_at_risk: 1, escalated: 3, total_open: 8 },
};

const settingsResponse = {
  sla_defaults: { ack_minutes: 15, close_hours: 72 },
  incident_types: ["Injury", "Fire", "Spill"],
  sla_rules: [],
};

const reportsResponse = {
  reports: [
    {
      id: 1,
      name: "Status Summary",
      description: "By status",
      created_by: 1,
      config: { group_by: "status" },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
};

describe("Admin.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(http.get).mockImplementation((url: string) => {
      if (url === "/admin/metrics" || url.startsWith("/admin/metrics")) {
        return Promise.resolve({ data: metricsResponse });
      }
      if (url === "/settings/config") {
        return Promise.resolve({ data: settingsResponse });
      }
      if (url === "/reports") {
        return Promise.resolve({ data: reportsResponse });
      }
      if (url.startsWith("/reports/") && url.endsWith("/run")) {
        return Promise.resolve({ data: { summary: [{ dimension: "New", count: 5 }] } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it("renders the admin dashboard header", async () => {
    const wrapper = mount(AdminView);
    await flushPromises();
    expect(wrapper.text()).toContain("Operations Intelligence");
    expect(wrapper.text()).toContain("Admin and Auditor Analytics");
  });

  it("loads metrics and settings on mount", async () => {
    const wrapper = mount(AdminView);
    await flushPromises();

    expect(http.get).toHaveBeenCalledWith("/admin/metrics", expect.anything());
    expect(http.get).toHaveBeenCalledWith("/settings/config");
    expect(wrapper.text()).toContain("Incident Distribution");
    expect(wrapper.text()).toContain("Moderation and Workflow Actions");
    expect(wrapper.text()).toContain("User Activity Logs");
  });

  it("displays the Safety Manager Configuration section", async () => {
    const wrapper = mount(AdminView);
    await flushPromises();

    expect(wrapper.text()).toContain("Safety Manager Configuration");
    expect(wrapper.text()).toContain("Acknowledgement SLA");
    expect(wrapper.text()).toContain("Closure SLA");
    expect(wrapper.text()).toContain("Incident Types");
  });

  it("populates settings fields from API response", async () => {
    const wrapper = mount(AdminView);
    await flushPromises();

    const ackInput = wrapper.find("input[type='number'][min='1'][max='240']");
    expect((ackInput.element as HTMLInputElement).value).toBe("15");

    const closeInput = wrapper.find("input[type='number'][min='1'][max='720']");
    expect((closeInput.element as HTMLInputElement).value).toBe("72");
  });

  it("saves settings when Save Configuration is clicked", async () => {
    vi.mocked(http.patch).mockResolvedValue({ data: {} });

    const wrapper = mount(AdminView);
    await flushPromises();

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("Save Configuration"));
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(http.patch).toHaveBeenCalledWith("/settings/sla", { ack_minutes: 15, close_hours: 72 });
    expect(http.patch).toHaveBeenCalledWith("/settings/incident-types", {
      incident_types: ["Injury", "Fire", "Spill"],
    });
    expect(http.patch).toHaveBeenCalledWith("/settings/sla-rules", { rules: [] });
    expect(wrapper.text()).toContain("Settings saved successfully.");
  });

  it("shows error when save fails", async () => {
    vi.mocked(http.patch).mockRejectedValueOnce({
      response: { data: { error: "Validation failed" } },
    });

    const wrapper = mount(AdminView);
    await flushPromises();

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("Save Configuration"));
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(wrapper.find(".error").text()).toBe("Validation failed");
  });

  it("shows error when metrics load fails", async () => {
    vi.mocked(http.get).mockRejectedValueOnce({
      response: { data: { error: "Dashboard unavailable" } },
    });

    const wrapper = mount(AdminView);
    await flushPromises();

    expect(wrapper.find(".error").text()).toBe("Dashboard unavailable");
  });

  it("calls downloadCsv when CSV Export is clicked", async () => {
    const wrapper = mount(AdminView);
    await flushPromises();

    const csvBtn = wrapper.findAll("button").find((b) => b.text().includes("CSV Export"));
    await csvBtn!.trigger("click");

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadCsv).mock.calls[0][1]).toEqual(["metric_group", "dimension", "count"]);
  });

  it("displays SLA at-risk metrics", async () => {
    const wrapper = mount(AdminView);
    await flushPromises();

    expect(wrapper.text()).toContain("Total Open Incidents");
    expect(wrapper.text()).toContain("Ack SLA at Risk");
    expect(wrapper.text()).toContain("Close SLA at Risk");
    expect(wrapper.text()).toContain("Escalated");
  });

  it("shows Refreshing... text while loading", async () => {
    vi.mocked(http.get).mockImplementation(() => new Promise(() => {}));

    const wrapper = mount(AdminView);
    await wrapper.vm.$nextTick();

    const refreshBtn = wrapper.findAll("button").find((b) => b.text().includes("Refreshing..."));
    expect(refreshBtn).toBeTruthy();
  });

  it("loads and displays Custom Reports section and saved report list", async () => {
    const wrapper = mount(AdminView);
    await flushPromises();

    expect(wrapper.text()).toContain("Custom Reports");
    expect(wrapper.text()).toContain("Status Summary");
  });

  it("creates report with expected payload", async () => {
    vi.mocked(http.post).mockResolvedValue({ data: { id: 2 } });
    const wrapper = mount(AdminView);
    await flushPromises();

    const inputs = wrapper.findAll("input");
    const reportNameInput = inputs.find((i) => i.attributes("placeholder") === "Monthly Site Summary" || i.attributes("placeholder") === "Monthly Site Summary");
    await reportNameInput!.setValue("Monthly Site Summary");

    const saveReportBtn = wrapper.findAll("button").find((b) => b.text().includes("Save Report Definition"));
    await saveReportBtn!.trigger("click");
    await flushPromises();

    expect(http.post).toHaveBeenCalledWith("/reports", expect.objectContaining({
      name: "Monthly Site Summary",
      config: expect.any(Object),
    }));
  });

  it("runs report and renders run results", async () => {
    const wrapper = mount(AdminView);
    await flushPromises();

    const runBtn = wrapper.findAll("button").find((b) => b.text() === "Run");
    await runBtn!.trigger("click");
    await flushPromises();

    expect(http.get).toHaveBeenCalledWith("/reports/1/run");
    expect(wrapper.text()).toContain("Report Results: Status Summary");
    expect(wrapper.text()).toContain("New");
  });

  it("deletes report and refreshes list", async () => {
    vi.mocked(http.delete).mockResolvedValue({ data: { message: "Report deleted" } });
    const wrapper = mount(AdminView);
    await flushPromises();

    const deleteBtn = wrapper.findAll("button").find((b) => b.text() === "Delete");
    await deleteBtn!.trigger("click");
    await flushPromises();

    expect(http.delete).toHaveBeenCalledWith("/reports/1");
    expect(http.get).toHaveBeenCalledWith("/reports");
  });
});
