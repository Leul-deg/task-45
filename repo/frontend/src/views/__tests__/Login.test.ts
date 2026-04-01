import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import LoginView from "../Login.vue";
vi.mock("../../utils/http", () => ({
  http: {
    post: vi.fn(),
    get: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));
vi.mock("../../utils/auth", () => ({
  saveSession: vi.fn(),
  getSession: vi.fn(() => null),
  hasValidSession: vi.fn(() => false),
  isPrivacyConsentAccepted: vi.fn(() => true),
  defaultRouteForRole: vi.fn(() => "/report"),
}));
import { http } from "../../utils/http";
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: LoginView },
    { path: "/report", component: { template: "<div />" } },
    { path: "/privacy-consent", component: { template: "<div />" } },
  ],
});
describe("Login.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("renders the login form with username and password fields", () => {
    const wrapper = mount(LoginView, { global: { plugins: [router] } });
    expect(wrapper.find("input[autocomplete='username']").exists()).toBe(true);
    expect(wrapper.find("input[type='password']").exists()).toBe(true);
    expect(wrapper.find("button[type='submit']").exists()).toBe(true);
  });
  it("disables submit button when fields are empty", () => {
    const wrapper = mount(LoginView, { global: { plugins: [router] } });
    const btn = wrapper.find("button[type='submit']");
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
  });
  it("enables submit button when both fields are filled", async () => {
    const wrapper = mount(LoginView, { global: { plugins: [router] } });
    await wrapper.find("input[autocomplete='username']").setValue("admin");
    await wrapper.find("input[type='password']").setValue("admin123");
    const btn = wrapper.find("button[type='submit']");
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
  });
  it("shows error message on login failure", async () => {
    const mockPost = vi.mocked(http.post);
    mockPost.mockRejectedValueOnce({
      response: { data: { error: "Invalid credentials" } },
    });
    const wrapper = mount(LoginView, { global: { plugins: [router] } });
    await wrapper.find("input[autocomplete='username']").setValue("admin");
    await wrapper.find("input[type='password']").setValue("wrong");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".error").text()).toBe("Invalid credentials");
  });
  it("shows 'Signing in...' on the button while loading", async () => {
    const mockPost = vi.mocked(http.post);
    mockPost.mockImplementation(() => new Promise(() => {}));
    const wrapper = mount(LoginView, { global: { plugins: [router] } });
    await wrapper.find("input[autocomplete='username']").setValue("admin");
    await wrapper.find("input[type='password']").setValue("pass");
    await wrapper.find("form").trigger("submit");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("button[type='submit']").text()).toBe("Signing in...");
  });
});
