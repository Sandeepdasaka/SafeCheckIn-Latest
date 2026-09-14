// routes/policeGuestPhotoRoutes.js
// The only route group that can ever return guest photo / ID document
// bytes. Mounted at /api/police/guests in server.js, behind police auth.
const express = require("express");
const router = express.Router();

const { authenticatePolice } = require("../middleware/policeAuth");
const {
  getGuestPhotoForPolice,
} = require("../controllers/policeGuestPhotoController");

router.use(authenticatePolice);

// GET /api/police/guests/:guestId/photo/:photoType
router.get("/:guestId/photo/:photoType", getGuestPhotoForPolice);

module.exports = router;
