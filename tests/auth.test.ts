import request from "supertest";
import { createApp } from "../src/app";
import { AdminUser } from "../src/modules/auth/auth.model";
import bcrypt from "bcryptjs";

describe("Admin Authentication & Security", () => {
  const app = createApp();

  beforeEach(async () => {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash("AdminPassword123!", salt);

    await AdminUser.create({
      email: "testadmin@movieplatform.com",
      passwordHash,
      name: "Test Admin",
      role: "ADMIN"
    });
  });

  it("should successfully log in with correct credentials and return JWT token", async () => {
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({
        email: "testadmin@movieplatform.com",
        password: "AdminPassword123!"
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe("testadmin@movieplatform.com");
    // Ensure password hash is NOT leaked
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it("should reject login with wrong password", async () => {
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({
        email: "testadmin@movieplatform.com",
        password: "WrongPassword"
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("should reject access to protected admin routes without bearer token", async () => {
    const res = await request(app).get("/api/admin/storage");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("should allow access to protected routes with valid bearer token", async () => {
    const loginRes = await request(app)
      .post("/api/admin/auth/login")
      .send({
        email: "testadmin@movieplatform.com",
        password: "AdminPassword123!"
      });

    const token = loginRes.body.data.token;

    const res = await request(app)
      .get("/api/admin/storage")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
