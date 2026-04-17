import request from "supertest";
import app from "../../src/app";

jest.mock("../../src/db/pool", () => ({
  dbPool: {
    query: jest.fn().mockResolvedValue([[], []]),
    execute: jest.fn().mockResolvedValue([{}, {}]),
  },
}));

describe("GET /health", () => {
  test("returns 200 with { status: 'ok' }", async () => {
    const res = await request(app).get("/health").send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  test("does not require an Authorization header", async () => {
    const res = await request(app).get("/health").send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
