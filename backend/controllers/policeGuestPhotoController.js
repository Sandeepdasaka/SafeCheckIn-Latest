// controllers/policeGuestPhotoController.js
//
// The ONLY place in the backend that serves a guest's actual photo or ID
// document bytes. Hotel/receptionist tokens are rejected before they ever
// reach here (see middleware/policeAuth.js, mounted in front of this
// controller in routes/policeGuestPhotoRoutes.js). Every view is logged to
// ActivityLog for audit purposes.
const Guest = require("../models/Guest");
const { logActivity } = require("./activityController");

const PHOTO_TYPES = ["guestPhoto", "idFront", "idBack"];

const getGuestPhotoForPolice = async (req, res) => {
  try {
    const { guestId, photoType } = req.params;

    if (!PHOTO_TYPES.includes(photoType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid photo type. Must be one of: ${PHOTO_TYPES.join(", ")}`,
      });
    }

    const guest = await Guest.findById(guestId);
    if (!guest) {
      return res.status(404).json({
        success: false,
        message: "Guest not found",
      });
    }

    const photoInfo = guest.photos?.[photoType];
    if (!photoInfo || !photoInfo.data) {
      return res.status(404).json({
        success: false,
        message: "Photo not found for this guest",
      });
    }

    // Audit trail: every time an officer looks at a guest's photo/ID, it's
    // recorded - this is what makes the "police only" restriction meaningful
    // rather than just a UI convention.
    logActivity(
      req.user?.policeId?.toString() || req.user?.id?.toString(),
      "evidence_viewed",
      "guest",
      guest._id.toString(),
      {
        guestName: guest.name,
        photoType,
        viewedBy: req.user?.name || "Police Officer",
        badgeNumber: req.user?.badgeNumber,
      },
      req,
    ).catch((err) => console.warn("Photo-view activity logging failed:", err.message));

    const buffer = Buffer.from(photoInfo.data, "base64");

    res.setHeader("Content-Type", photoInfo.mimeType || "image/jpeg");
    // No long-lived caching: this is sensitive identity data, and letting a
    // shared/browser cache retain it defeats the point of gating it behind
    // an authenticated, audited endpoint.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${photoInfo.filename || photoType}"`,
    );

    return res.send(buffer);
  } catch (error) {
    console.error("Error serving guest photo to police:", error);
    res.status(500).json({
      success: false,
      message: "Error serving photo",
      error: error.message,
    });
  }
};

module.exports = { getGuestPhotoForPolice };
