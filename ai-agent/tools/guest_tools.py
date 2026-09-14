"""
search_guests — never returns photo bytes or photo URLs to the LLM. A chat
message can't carry an Authorization header, so even a police-only endpoint
can't be safely embedded as a plain markdown image link here (the browser's
<img> request would have no token and just 401). Guest photos and ID scans
are viewable ONLY through the dedicated, audited Suspect Profile UI in the
police dashboard (see backend/routes/policeGuestPhotoRoutes.js), which
fetches them with a real Authorization header. This module only tells the
caller whether photos exist, and only when the caller is police.
"""
import re
from db.mongo import guests, hotels
from tools.helpers import mask_aadhaar, to_ist, str_to_object_id
from tools.jurisdiction_utils import get_jurisdiction_hotel_ids
from config.settings import get_settings

settings = get_settings()


def _documents_status(doc: dict) -> str | None:
    """
    Police-only, plain-text status - never a URL or image tag. Hotel callers
    never see this field at all (see call site below).
    """
    photos = doc.get("photos", {})
    if not photos:
        return None

    captured = [
        field
        for field in ("guestPhoto", "idFront", "idBack")
        if bool((photos.get(field) or {}).get("data"))
    ]
    if not captured:
        return None

    return "Captured — view in Suspect Profile → Documents tab (police only)"


async def search_guests(
    params: dict,
    hotel_id: str | None = None,
    is_police: bool = False,
    police_id: str | None = None,
    police_role: str | None = None,
) -> list[dict] | str:

    query: dict = {}

    if hotel_id:
        oid = str_to_object_id(hotel_id)
        query["hotelId"] = oid if oid else hotel_id

    if is_police:
        if params.get("hotel_name"):
            hotel_doc = await hotels().find_one(
                {"name": {"$regex": params["hotel_name"], "$options": "i"}}
            )
            if not hotel_doc:
                return f"No hotel found matching '{params['hotel_name']}'."

            if police_id:
                jurisdiction_ids = await get_jurisdiction_hotel_ids(police_id, police_role)
                if jurisdiction_ids is None:
                    return "Your jurisdiction has not been configured yet — no guests to show."
                if hotel_doc["_id"] not in jurisdiction_ids:
                    return f"'{params['hotel_name']}' is outside your jurisdiction."

            query["hotelId"] = hotel_doc["_id"]

        elif police_id:
            jurisdiction_ids = await get_jurisdiction_hotel_ids(police_id, police_role)
            if jurisdiction_ids is None:
                return "Your jurisdiction has not been configured yet — no guests to show."
            query["hotelId"] = {"$in": jurisdiction_ids}

    if params.get("name"):
        query["name"] = {"$regex": params["name"], "$options": "i"}

    if params.get("nationality"):
        query["nationality"] = {"$regex": params["nationality"], "$options": "i"}

    if params.get("room"):
        query["roomNumber"] = str(params["room"])

    if params.get("aadhaar_last4"):
        last4 = re.escape(params["aadhaar_last4"])
        query["guests.idNumber"] = {"$regex": f"{last4}$"}

    status = params.get("status", "all")
    if status and status != "all":
        query["status"] = "checked-in" if status == "active" else status

    if params.get("checkin_today"):
        from datetime import datetime, timezone
        today = datetime.now(tz=timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        query["checkInTime"] = {"$gte": today}

    limit = min(int(params.get("limit", 10)), 20)
    cursor = guests().find(query).sort("checkInTime", -1).limit(limit)
    results = []

    async for doc in cursor:
        aadhaar_display = "N/A"
        for g in doc.get("guests", []):
            if g.get("idNumber"):
                aadhaar_display = mask_aadhaar(g["idNumber"])
            break

        row = {
            "name":         doc.get("name", "Unknown"),
            "room":         doc.get("roomNumber", "N/A"),
            "status":       doc.get("status", "N/A"),
            "checked_in":   to_ist(doc.get("checkInTime")),
            "checked_out":  to_ist(doc.get("checkOutDate"))
                            if doc.get("checkOutDate") else "Still checked in",
            "nationality":  doc.get("nationality", "N/A"),
            "phone":        doc.get("phone", "N/A"),
            "purpose":      doc.get("purpose", "N/A"),
            "total_guests": doc.get("guestCount", 1),
            "booking_mode": doc.get("bookingMode", "N/A"),
            "aadhaar":      aadhaar_display,
        }

        # Hotel callers never learn whether photos exist beyond what the
        # check-in UI already told the receptionist — no field is added at
        # all for is_police=False, so there is nothing for the model to
        # turn into a link even if it tried.
        if is_police:
            documents_status = _documents_status(doc)
            if documents_status:
                row["documents"] = documents_status

        if is_police and doc.get("hotelId"):
            hotel_doc = await hotels().find_one(
                {"_id": doc["hotelId"]}, {"name": 1}
            )
            row["hotel"] = hotel_doc.get("name", "Unknown Hotel") if hotel_doc else "Unknown Hotel"

        results.append(row)

    return results if results else "No guests found matching those criteria."