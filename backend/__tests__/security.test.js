// __tests__/security.test.js
//
// End-to-end-style tests for the security work: ID/photo masking for
// hotel-facing responses, police-only photo access, and OTP 2FA login.
//
// There is no live MongoDB in this environment (see the test report this
// suite was written for), so the Mongoose *models* are mocked - everything
// else is real: real Express routers, real auth/rate-limit middleware,
// real JWT signing/verification, real bcrypt hashing, real controller
// logic. This exercises the actual request path, not a reimplementation
// of it.

process.env.JWT_SECRET = "test-secret-at-least-32-characters-long!!";
process.env.NODE_ENV = "test"; // not "production" - so devOtp is echoed

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const { maskIdNumber } = require("../utils/mask");
const { generateOtp, hashOtp, verifyOtpHash } = require("../utils/otp");

// ─────────────────────────────────────────────────────────────────────────
// Unit tests: pure logic, no mocking needed
// ─────────────────────────────────────────────────────────────────────────
describe("maskIdNumber", () => {
  test("masks a 12-digit Aadhaar as XXXX-XXXX-<last4>", () => {
    expect(maskIdNumber("123456789012", "Aadhar Card")).toBe("XXXX-XXXX-9012");
  });

  test("masks a generic ID (e.g. passport) to stars + last4", () => {
    expect(maskIdNumber("M1234567", "Passport")).toBe("****4567");
  });

  test("masks something at or under 4 chars entirely", () => {
    expect(maskIdNumber("123", "Other")).toBe("***");
  });

  test("passes through falsy values unchanged", () => {
    expect(maskIdNumber("", "Aadhar Card")).toBe("");
    expect(maskIdNumber(undefined, "Aadhar Card")).toBeUndefined();
  });
});

describe("OTP helpers", () => {
  test("generateOtp produces a 6-digit numeric string", () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  test("hashOtp/verifyOtpHash round-trip correctly", async () => {
    const otp = "482913";
    const hash = await hashOtp(otp);
    expect(hash).not.toBe(otp);
    await expect(verifyOtpHash(otp, hash)).resolves.toBe(true);
    await expect(verifyOtpHash("000000", hash)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration: hotel-facing guest endpoint must mask ID numbers and strip
// photo bytes (see controllers/guestController.js's sanitizeGuestForHotel)
// ─────────────────────────────────────────────────────────────────────────
describe("Hotel-facing guest responses (masking)", () => {
  jest.resetModules();

  const guestData = {
    _id: "g1",
    name: "Raja Kumar",
    phone: "9876543210",
    hotelId: "h1",
    roomNumber: "204",
    status: "checked-in",
    guests: [
      { name: "Raja Kumar", idType: "Aadhar Card", idNumber: "123456789012", isPrimary: true },
    ],
    photos: {
      guestPhoto: { data: "ZmFrZWJhc2U2NA==", mimeType: "image/jpeg", uploadTime: new Date() },
      idFront: { data: "ZmFrZQ==", mimeType: "image/jpeg", uploadTime: new Date() },
      idBack: {},
    },
  };

  const makeGuestDoc = (overrides = {}) => {
    const data = { ...guestData, ...overrides };
    return {
      ...data,
      populate: jest.fn().mockResolvedValue(undefined),
      toObject: () => ({ ...data }),
    };
  };

  jest.doMock("../models/Guest", () => ({
    findOne: jest.fn(),
  }));
  jest.doMock("../models/Hotel", () => ({
    findById: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  }));
  jest.doMock("../controllers/activityController", () => ({
    logActivity: jest.fn().mockResolvedValue(undefined),
  }));

  const Guest = require("../models/Guest");
  const Hotel = require("../models/Hotel");
  const guestRoutes = require("../routes/guestRoutes");

  const app = express();
  app.use(express.json());
  app.use("/api/guests", guestRoutes);

  const hotelToken = jwt.sign(
    { hotelId: "h1", id: "h1", type: "hotel", name: "Test Hotel" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  beforeEach(() => {
    Hotel.findById.mockResolvedValue({
      _id: "h1",
      isActive: true,
      name: "Test Hotel",
      lastActivityAt: new Date(),
    });
  });

  test("GET /api/guests/:id masks idNumber and strips photo bytes", async () => {
    Guest.findOne.mockResolvedValue(makeGuestDoc());

    const res = await request(app)
      .get("/api/guests/g1")
      .set("Authorization", `Bearer ${hotelToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const returnedGuest = res.body.data.guests[0];
    expect(returnedGuest.idNumber).toBe("XXXX-XXXX-9012");
    expect(returnedGuest.idNumber).not.toContain("1234567890"); // full number never leaves

    expect(res.body.data.photos.guestPhoto).toEqual({
      captured: true,
      mimeType: "image/jpeg",
      uploadTime: expect.anything(),
    });
    expect(res.body.data.photos.guestPhoto.data).toBeUndefined();
    expect(res.body.data.photos.idBack).toEqual({ captured: false });

    // The raw response body must not contain the unmasked ID number or the
    // base64 photo payload anywhere, not just in the fields we checked.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("123456789012");
    expect(raw).not.toContain("ZmFrZWJhc2U2NA==");
  });

  test("GET /api/guests/:id with no token is rejected", async () => {
    const res = await request(app).get("/api/guests/g1");
    expect(res.status).toBe(401);
  });

  test("GET /api/guests/:id for a guest at a different hotel returns 404, not another hotel's data", async () => {
    Guest.findOne.mockResolvedValue(null); // findOne({_id, hotelId}) - no match since hotelId differs
    const res = await request(app)
      .get("/api/guests/g1")
      .set("Authorization", `Bearer ${hotelToken}`);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration: police-only photo endpoint
// ─────────────────────────────────────────────────────────────────────────
describe("Police-only photo endpoint", () => {
  jest.resetModules();

  const photoBuffer = Buffer.from("not-a-real-jpeg-but-good-enough");
  const guestWithPhoto = {
    _id: "g1",
    name: "Raja Kumar",
    photos: {
      guestPhoto: {
        data: photoBuffer.toString("base64"),
        mimeType: "image/jpeg",
        filename: "guestPhoto.jpg",
      },
    },
  };

  jest.doMock("../models/Guest", () => ({ findById: jest.fn() }));
  jest.doMock("../models/Police", () => ({ findById: jest.fn() }));
  jest.doMock("../controllers/activityController", () => ({
    logActivity: jest.fn().mockResolvedValue(undefined),
  }));

  const Guest = require("../models/Guest");
  const Police = require("../models/Police");
  const policeGuestPhotoRoutes = require("../routes/policeGuestPhotoRoutes");

  const app = express();
  app.use(express.json());
  app.use("/api/police/guests", policeGuestPhotoRoutes);

  const policeDoc = {
    _id: "p1",
    isActive: true,
    updateActivity: jest.fn().mockResolvedValue(undefined),
    lastActivityAt: new Date(),
  };

  const policeToken = jwt.sign(
    { policeId: "p1", role: "police", policeRole: "sub_police", name: "Test Officer" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  const hotelToken = jwt.sign(
    { hotelId: "h1", id: "h1", type: "hotel", name: "Test Hotel" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  beforeEach(() => {
    Police.findById.mockResolvedValue(policeDoc);
    Guest.findById.mockResolvedValue(guestWithPhoto);
  });

  test("a valid police token can fetch the photo bytes", async () => {
    const res = await request(app)
      .get("/api/police/guests/g1/photo/guestPhoto")
      .set("Authorization", `Bearer ${policeToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.compare(res.body, photoBuffer)).toBe(0);
  });

  test("a hotel token is rejected (police role required)", async () => {
    const res = await request(app)
      .get("/api/police/guests/g1/photo/guestPhoto")
      .set("Authorization", `Bearer ${hotelToken}`);

    expect(res.status).toBe(403);
  });

  test("no token is rejected", async () => {
    const res = await request(app).get("/api/police/guests/g1/photo/guestPhoto");
    expect(res.status).toBe(401);
  });

  test("an unknown photo type is rejected with 400, not a crash", async () => {
    const res = await request(app)
      .get("/api/police/guests/g1/photo/somethingElse")
      .set("Authorization", `Bearer ${policeToken}`);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration: police login → OTP → verified session (2FA)
// ─────────────────────────────────────────────────────────────────────────
describe("Police login OTP flow", () => {
  // Rebuild the router (and therefore a fresh authRateLimit instance - its
  // counters live in a closure created when middleware/security.js is
  // first evaluated) for every test, so tests can't drain each other's
  // rate-limit budget. This isolates "is the OTP-attempt-cap logic
  // correct" from "does the shared per-IP rate limit interfere" - see the
  // test report for why that distinction matters here.
  let app;
  let Police;
  let db;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock("../models/Police", () => ({
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    }));
    jest.doMock("../controllers/activityController", () => ({
      logActivity: jest.fn().mockResolvedValue(undefined),
    }));

    Police = require("../models/Police");
    const policeRoutes = require("../routes/policeRoutes");

    app = express();
    app.use(express.json());
    app.use("/api/police", policeRoutes);
  });

  const applyMongoUpdate = (doc, update) => {
    for (const [key, value] of Object.entries(update)) {
      if (key === "$inc") {
        for (const [incKey, incVal] of Object.entries(value)) {
          doc[incKey] = (doc[incKey] || 0) + incVal;
        }
      } else if (key.includes(".")) {
        const [parent, child] = key.split(".");
        doc[parent] = doc[parent] || {};
        doc[parent][child] = value;
      } else {
        doc[key] = value;
      }
    }
    return doc;
  };

  beforeEach(async () => {
    db = {
      _id: "p1",
      email: "officer@police.gov.in",
      password: await bcrypt.hash("correct-password", 10),
      isActive: true,
      role: "sub_police",
      badgeNumber: "B100",
      name: "Test Officer",
      station: "Test Station",
      rank: "SI",
      loginCount: 0,
      otp: { hash: null, expiresAt: null, attempts: 0 },
      lastActivityAt: new Date(), // recent, so authenticatePolice skips updateActivity()
      updateActivity: jest.fn().mockResolvedValue(undefined),
    };

    Police.findOne.mockImplementation(async (query) =>
      query.email === db.email && db.isActive ? { ...db } : null,
    );
    Police.findById.mockImplementation(async (id) => (id === db._id ? { ...db } : null));
    Police.findByIdAndUpdate.mockImplementation(async (id, update) => {
      if (id !== db._id) return null;
      applyMongoUpdate(db, update);
      return { ...db };
    });
  });

  test("correct password does NOT issue a usable session token directly", async () => {
    const res = await request(app)
      .post("/api/police/login")
      .send({ email: "officer@police.gov.in", password: "correct-password" });

    expect(res.status).toBe(200);
    expect(res.body.requiresOtp).toBe(true);
    expect(res.body.token).toBeUndefined(); // no full JWT yet
    expect(res.body.otpToken).toBeTruthy();
    expect(res.body.devOtp).toMatch(/^\d{6}$/); // demo-mode echo, NODE_ENV!=production
  });

  test("wrong password never reaches the OTP stage", async () => {
    const res = await request(app)
      .post("/api/police/login")
      .send({ email: "officer@police.gov.in", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.requiresOtp).toBeUndefined();
  });

  test("full flow: login -> correct OTP -> real token that passes authenticatePolice", async () => {
    const loginRes = await request(app)
      .post("/api/police/login")
      .send({ email: "officer@police.gov.in", password: "correct-password" });

    const { otpToken, devOtp } = loginRes.body;

    const otpRes = await request(app)
      .post("/api/police/login/verify-otp")
      .send({ otpToken, otp: devOtp });

    expect(otpRes.status).toBe(200);
    expect(otpRes.body.success).toBe(true);
    expect(typeof otpRes.body.token).toBe("string");

    // The issued token should decode as a real, full police JWT (not the
    // otp-pending token), and it should now unlock a protected endpoint.
    const decoded = jwt.verify(otpRes.body.token, process.env.JWT_SECRET);
    expect(decoded.policeId).toBe("p1");
    expect(decoded.role).toBe("police");

    const healthRes = await request(app)
      .get("/api/police/health")
      .set("Authorization", `Bearer ${otpRes.body.token}`);
    expect(healthRes.status).toBe(200);
  });

  test("wrong OTP is rejected and counts against the attempt limit", async () => {
    const loginRes = await request(app)
      .post("/api/police/login")
      .send({ email: "officer@police.gov.in", password: "correct-password" });

    const { otpToken } = loginRes.body;

    const badRes = await request(app)
      .post("/api/police/login/verify-otp")
      .send({ otpToken, otp: "000000" });

    expect(badRes.status).toBe(401);
    expect(badRes.body.code).toBe("INVALID_OTP");
    expect(db.otp.attempts).toBe(1);
  });

  test("5 wrong OTP attempts locks out the pending login", async () => {
    const loginRes = await request(app)
      .post("/api/police/login")
      .send({ email: "officer@police.gov.in", password: "correct-password" });
    const { otpToken } = loginRes.body;

    let lastRes;
    for (let i = 0; i < 6; i++) {
      lastRes = await request(app)
        .post("/api/police/login/verify-otp")
        .send({ otpToken, otp: "000000" });
    }

    expect(lastRes.status).toBe(429);
    expect(lastRes.body.code).toBe("OTP_LOCKED");
  });

  test("the otp-pending token cannot be used against a protected police route", async () => {
    const loginRes = await request(app)
      .post("/api/police/login")
      .send({ email: "officer@police.gov.in", password: "correct-password" });

    const res = await request(app)
      .get("/api/police/health")
      .set("Authorization", `Bearer ${loginRes.body.otpToken}`);

    // The otp-pending token has no `role`/`policeRole` claims, so
    // authenticatePolice must reject it just like any other invalid token.
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration: hotel's read-only suspect view must mask the Aadhaar
// snapshot and reduce photo URLs to booleans (see hotelSuspectRoutes.js's
// sanitizeSuspectForHotel)
// ─────────────────────────────────────────────────────────────────────────
describe("Hotel-facing suspect responses (masking)", () => {
  jest.resetModules();

  // Mongoose query objects are thenable and chainable - this stands in
  // for both without needing a real query engine.
  const makeQuery = (resolvedValue) => {
    const query = {
      populate: jest.fn(() => query),
      select: jest.fn(() => query),
      sort: jest.fn(() => query),
      skip: jest.fn(() => query),
      limit: jest.fn(() => query),
      lean: jest.fn(() => query),
      then: (resolve, reject) => Promise.resolve(resolvedValue).then(resolve, reject),
    };
    return query;
  };

  const suspectRecord = {
    _id: "s1",
    hotelId: "h1",
    isActive: true,
    status: "Active",
    suspectData: {
      name: "Raja Kumar",
      phone: "9876543210",
      aadhar: "123456789012",
      roomNumber: "204",
      photos: {
        guestPhoto: "/api/police/guests/g1/photo/guestPhoto",
        idFront: "/api/police/guests/g1/photo/idFront",
        idBack: null,
      },
    },
    verifiedBy: { name: "Officer K", rank: "SI" },
    associatedAlerts: [],
  };

  jest.doMock("../models/Suspect", () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
  }));
  jest.doMock("../models/Hotel", () => ({
    findById: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  }));

  const Suspect = require("../models/Suspect");
  const Hotel = require("../models/Hotel");
  const hotelSuspectRoutes = require("../routes/hotelSuspectRoutes");

  const app = express();
  app.use(express.json());
  app.use("/api/hotel/suspects", hotelSuspectRoutes);

  const hotelToken = jwt.sign(
    { hotelId: "h1", id: "h1", type: "hotel", name: "Test Hotel" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  beforeEach(() => {
    Hotel.findById.mockResolvedValue({
      _id: "h1",
      isActive: true,
      name: "Test Hotel",
      lastActivityAt: new Date(),
    });
    Suspect.find.mockReturnValue(makeQuery([{ ...suspectRecord }]));
    Suspect.countDocuments.mockResolvedValue(1);
    Suspect.findOne.mockReturnValue(makeQuery({ ...suspectRecord }));
  });

  test("GET /api/hotel/suspects masks the Aadhaar and reduces photos to booleans", async () => {
    const res = await request(app)
      .get("/api/hotel/suspects")
      .set("Authorization", `Bearer ${hotelToken}`);

    expect(res.status).toBe(200);
    const suspect = res.body.suspects[0];
    // Generic masked format, not the prettier "XXXX-XXXX-1234" Aadhaar
    // style: Suspect.suspectData has no idType field, so
    // sanitizeSuspectForHotel can't tell maskIdNumber this is an Aadhaar -
    // see the test report for why the two masking call sites disagree on
    // format (both are equally safe; only the cosmetic format differs).
    expect(suspect.suspectData.aadhar).toBe("********9012");
    expect(suspect.suspectData.aadhar).not.toContain("123456789012");
    expect(suspect.suspectData.photos).toEqual({
      guestPhoto: true,
      idFront: true,
      idBack: false,
    });

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("123456789012");
    expect(raw).not.toContain("/api/police/guests/g1/photo"); // no police-only URLs leaked either
  });

  test("GET /api/hotel/suspects/:id masks the Aadhaar and reduces photos to booleans", async () => {
    const res = await request(app)
      .get("/api/hotel/suspects/s1")
      .set("Authorization", `Bearer ${hotelToken}`);

    expect(res.status).toBe(200);
    expect(res.body.suspect.suspectData.aadhar).toBe("********9012"); // see note above
    expect(res.body.suspect.suspectData.photos).toEqual({
      guestPhoto: true,
      idFront: true,
      idBack: false,
    });
  });
});
