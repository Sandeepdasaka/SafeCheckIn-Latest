// components/Dashboard/SuspectDocuments.tsx
//
// Police-only viewer for a guest's captured photo and ID document scans.
// This is the ONLY place in either frontend app that renders these images.
// A plain <img src="..."> can't carry an Authorization header, so it can't
// be pointed at the protected backend endpoint directly - instead we fetch
// the bytes ourselves (with the officer's bearer token), turn them into a
// short-lived blob: URL for display, and revoke that URL as soon as it's
// no longer shown so the image doesn't linger in memory or in the
// browser's URL table.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { User, Camera, Eye, Download, Loader2, ImageOff } from "lucide-react";

interface SuspectDocumentsProps {
  guestId?: string | null;
  token: string;
}

const PHOTO_TYPES: { key: "guestPhoto" | "idFront" | "idBack"; label: string; description: string }[] = [
  { key: "guestPhoto", label: "Guest Photo", description: "Primary guest photograph" },
  { key: "idFront", label: "ID Front", description: "Front side of ID document" },
  { key: "idBack", label: "ID Back", description: "Back side of ID document" },
];

const getPoliceToken = (fallback: string) =>
  fallback ||
  localStorage.getItem("policeToken") ||
  sessionStorage.getItem("policeToken") ||
  "";

export default function SuspectDocuments({ guestId, token }: SuspectDocumentsProps) {
  const [preview, setPreview] = useState<{ key: string; label: string; url: string } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Always revoke the blob URL when it's replaced or the component unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  if (!guestId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-500">
          <ImageOff className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>No linked guest record — documents unavailable.</p>
        </CardContent>
      </Card>
    );
  }

  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";

  const loadPhoto = async (photoType: string, label: string) => {
    setError(null);
    setLoadingKey(photoType);
    try {
      const authToken = getPoliceToken(token);
      const res = await fetch(
        `${apiUrl}/api/police/guests/${guestId}/photo/${photoType}`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );

      if (res.status === 404) {
        setError(`${label} was not captured for this guest.`);
        return;
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { key: photoType, label, url };
      });
    } catch (err) {
      console.error("Failed to load document:", err);
      setError(`Could not load ${label}. Please try again.`);
    } finally {
      setLoadingKey(null);
    }
  };

  const handleDownload = () => {
    if (!preview) return;
    const link = document.createElement("a");
    link.href = preview.url;
    link.download = `${preview.label.replace(/\s+/g, "_")}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <Card>
        <CardContent className="pt-4">
          <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Guest Photo &amp; ID Documents
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Viewable by verified police only. Every view below is recorded in
            the activity log.
          </p>
          {error && (
            <p className="text-xs text-red-600 mb-3">{error}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {PHOTO_TYPES.map(({ key, label, description }) => (
              <div
                key={key}
                className="border rounded-lg p-4 text-center flex flex-col items-center gap-2"
              >
                <User className="h-6 w-6 text-gray-400" />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-gray-500">{description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  disabled={loadingKey === key}
                  onClick={() => loadPhoto(key, label)}
                >
                  {loadingKey === key ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Eye className="h-3 w-3 mr-1" />
                  )}
                  View
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && preview) {
            URL.revokeObjectURL(preview.url);
            setPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>{preview?.label}</span>
              <Badge variant="secondary" className="text-xs">
                Police view — logged
              </Badge>
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <img
                src={preview.url}
                alt={preview.label}
                className="w-full rounded-lg border object-contain max-h-[70vh]"
              />
              <Button size="sm" variant="outline" onClick={handleDownload}>
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
