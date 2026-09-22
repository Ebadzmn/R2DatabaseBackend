import request from "supertest";
import { createApp } from "../src/app";
import { AdminUser } from "../src/modules/auth/auth.model";
import { Movie } from "../src/modules/movies/movie.model";
import jwt from "jsonwebtoken";

describe("Movie Management & Playback APIs", () => {
  const app = createApp();
  let adminToken: string;

  beforeEach(async () => {
    const admin = await AdminUser.create({
      email: "admin@movies.com",
      passwordHash: "dummyHash",
      name: "Admin",
      role: "ADMIN"
    });

    adminToken = jwt.sign(
      { adminId: admin._id.toString(), email: admin.email, role: "ADMIN" },
      process.env.JWT_SECRET || "test_jwt_secret_key_for_unit_tests_only"
    );
  });

  it("should create a movie in DRAFT status", async () => {
    const res = await request(app)
      .post("/api/admin/movies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Interstellar Horizon",
        description: "Epic sci-fi adventure",
        releaseYear: 2026,
        genres: ["Sci-Fi", "Adventure"]
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe("Interstellar Horizon");
    expect(res.body.data.slug).toContain("interstellar-horizon");
    expect(res.body.data.status).toBe("DRAFT");
  });

  it("should list movies publicly via /api/movies", async () => {
    await Movie.create({
      title: "Public Movie 1",
      slug: "public-movie-1",
      status: "READY",
      genres: ["Action"]
    });

    const res = await request(app).get("/api/movies");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("should reject playback URL if movie is not READY", async () => {
    const movie = await Movie.create({
      title: "Unprocessed Movie",
      slug: "unprocessed-movie",
      status: "DRAFT"
    });

    const res = await request(app).get(`/api/movies/${movie._id}/playback`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  it("should return valid HLS playback URL when movie is READY", async () => {
    const movie = await Movie.create({
      title: "Ready Movie",
      slug: "ready-movie",
      status: "READY",
      hlsMasterKey: "movies/ready-movie/123/hls/master.m3u8",
      duration: 7200
    });

    const res = await request(app).get(`/api/movies/${movie._id}/playback`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe("HLS");
    expect(res.body.data.url).toContain("/movies/ready-movie/123/hls/master.m3u8");
    // Ensure zero secrets are present in response
    expect(JSON.stringify(res.body)).not.toContain("secretAccessKey");
    expect(JSON.stringify(res.body)).not.toContain("accessKeyId");
  });
});
