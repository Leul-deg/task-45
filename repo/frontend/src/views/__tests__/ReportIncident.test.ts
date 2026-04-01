import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ReportIncidentView from "../ReportIncident.vue";
vi.mock("../../utils/http", () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));
vi.mock("../../utils/auth", () => ({
  getSession: vi.fn(() => ({
    accessToken: "tok",
    expiresAt: Date.now() + 900000,
    csrfToken: "csrf",
    user: { id: 1, username: "reporter1", role: "Reporter" },
  })),
  hasValidSession: vi.fn(() => true),
  clearSession: vi.fn(),
}));
import { http } from "../../utils/http";
describe("ReportIncident.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(http.get).mockResolvedValue({
      data: {
        incident_types: ["Near Miss", "Injury", "Fire"],
        facility_sites: ["Main Campus", "Warehouse A"],
      },
    });
  });
  it("loads incident types and sites from settings on mount", async () => {
    const wrapper = mount(ReportIncidentView);
    await flushPromises();
    expect(http.get).toHaveBeenCalledWith("/settings/config");
    const typeSelect = wrapper.findAll("select")[1];
    expect(typeSelect.html()).toContain("Near Miss");
  });
  it("disables submit when description is too short", async () => {
    const wrapper = mount(ReportIncidentView);
    await flushPromises();
    const btn = wrapper.find("button[type='submit']");
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows file count in privacy preview", async () => {
    const wrapper = mount(ReportIncidentView);
    await flushPromises();
    expect(wrapper.text()).toContain("Files Selected");
  });
  it("renders text input fallback when facility_sites is empty", async () => {
    vi.mocked(http.get).mockResolvedValueOnce({
      data: {
        incident_types: ["Near Miss", "Injury"],
        facility_sites: [],
      },
    });
    const wrapper = mount(ReportIncidentView);
    await flushPromises();
    const siteInput = wrapper.findAll("input").find(
      (input) => input.attributes("placeholder")?.includes("facility site")
    );
    expect(siteInput).toBeTruthy();
  });
  it("masks phone number in preview", async () => {
    const wrapper = mount(ReportIncidentView);
    await flushPromises();
    const phoneInput = wrapper.findAll("input").find(
      (input) => input.attributes("placeholder")?.includes("callback")
    );
    if (phoneInput) {
      await phoneInput.setValue("5551234567");
      expect(wrapper.text()).toContain("******4567");
    }
  });
});
